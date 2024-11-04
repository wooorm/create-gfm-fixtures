/**
 * @typedef {import('hast').Root} Root
 *
 * @typedef Keep
 *   Keep certain parts of GHs pipelines.
 * @property {boolean} [dir=false]
 *   Keep `dir="auto"`.
 * @property {boolean} [heading=false]
 *   Keep `.anchor` in headings.
 * @property {boolean} [link=false]
 *   Keep `rel="nofollow"` on links.
 * @property {boolean} [camo=false]
 *   Keep `camo.githubusercontent.com` on images.
 * @property {boolean} [image=false]
 *   Keep `max-width:100%` on images and `a[target=_blank]` parent wrapper.
 * @property {boolean} [mention=false]
 *   Keep attributes on `.user-mention`s.
 * @property {boolean} [tasklist=false]
 *   Keep classes on tasklist-related elements, and `id` on their inputs.
 * @property {boolean} [frontmatter=false]
 *   Keep visible frontmatter.
 *
 * @typedef Options
 *   Configuration (optional).
 * @property {import('rehype-stringify').Options} [rehypeStringify]
 *   Configuration passed to `rehype-stringify`.
 * @property {boolean} [controlPictures=false]
 *   Handle control pictures.
 * @property {Keep} [keep={}]
 *   Keep certain parts of GHs pipeline.
 */

import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {controlPictures} from 'control-pictures'
// To do: use `fsPromises.glob` when Node 22 is minimum.
import {globby} from 'globby'
import {headingRank} from 'hast-util-heading-rank'
import {matches, select, selectAll} from 'hast-util-select'
import {toString} from 'hast-util-to-string'
import {whitespace} from 'hast-util-whitespace'
import fetch from 'node-fetch'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import replaceExt from 'replace-ext'
import {unified} from 'unified'
import {visit} from 'unist-util-visit'

const own = {}.hasOwnProperty

/**
 * Finds all markdown files inside `url` and generates HTML files for them if
 * they’re either a) missing, b) `UPDATE` is set in env.
 *
 * @param {URL} url
 *   URL to folder containing fixtures
 * @param {Options} [options={}]
 *   Configuration (optional).
 */
// eslint-disable-next-line complexity
export async function createGfmFixtures(url, options = {}) {
  const keep = options.keep || {}
  const rehype = unified().use(rehypeParse).use(rehypeStringify)

  const cleanMarkdownBody = unified()
    .use(rehypeParse, {fragment: true})
    // `sourcepos` is an extremely buggy GH feature that is dependent on their
    // markdown parser (`cmark-gfm`-like), whose positional info makes no sense.
    .use(cleanMarkupSourcepos)

  if (!keep.dir) cleanMarkdownBody.use(cleanMarkupDir)
  if (!keep.heading) cleanMarkdownBody.use(cleanMarkupAnchor)
  if (!keep.link) cleanMarkdownBody.use(cleanMarkupLinkRel)
  if (!keep.camo) cleanMarkdownBody.use(cleanMarkupCamoImage)
  if (!keep.image) cleanMarkdownBody.use(cleanMarkupImageStyle)
  if (!keep.image) cleanMarkdownBody.use(cleanMarkupImageLink)
  if (!keep.mention) cleanMarkdownBody.use(cleanMarkupUserMention)
  cleanMarkdownBody.use(cleanMarkupFootnoteIdHash)
  if (!keep.tasklist) cleanMarkdownBody.use(cleanMarkupTasklist)
  if (!keep.frontmatter) cleanMarkdownBody.use(cleanMarkupFrontmatter)
  cleanMarkdownBody.use(rehypeStringify, options.rehypeStringify || {})

  const cwd = fileURLToPath(url)
  const filePaths = await globby(['**/*.md'], {cwd})
  const allInput = await Promise.all(
    filePaths.map(async (relative) => {
      const inputUrl = pathToFileURL(path.join(cwd, relative))
      const outputUrl = pathToFileURL(
        path.join(cwd, replaceExt(relative, '.html'))
      )
      let generate = true
      const parts = path.basename(relative, path.extname(relative)).split('.')

      if (parts.includes('offline')) {
        generate = false
      } else if (!process.env.UPDATE) {
        try {
          await fs.access(outputUrl)
          generate = false
        } catch {}
      }

      const last = parts.pop()
      /** @type {'file'|'comment'} */
      const mode = last === 'comment' ? last : 'file'

      return {inputUrl, outputUrl, mode, generate}
    })
  )

  const input = await Promise.all(
    allInput
      .filter((d) => d.generate)
      .map(async ({generate, ...d}) => {
        let value = String(await fs.readFile(d.inputUrl))

        if (options.controlPictures) {
          value = controlPictures(value)
        }

        return {...d, value}
      })
  )

  // No crawling needed? Exit.
  if (input.length === 0) {
    return
  }

  // Note: the GH token needs `gists` access!
  // Either usage is okay (though `GITHUB_TOKEN` is the one set by GHA, which
  // doesn’t have gist scope).
  /* c8 ignore next 5 */
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

  if (!ghToken) {
    throw new Error('Missing GitHub token: expected `GH_TOKEN` in env')
  }

  const octo = new Octokit({auth: 'token ' + ghToken})

  /** @type {Record<string, number>} */
  const filenameToIndex = {}
  /** @type {Record<string, {content: string}>} */
  const files = {}
  let index = -1
  let fileInputIndex = 0
  while (++index < input.length) {
    const info = input[index]
    if (info.mode === 'file') {
      const name = 'readme-' + fileInputIndex + '.md'
      filenameToIndex[name] = index
      files[name] = {content: info.value}
      fileInputIndex++
    }
  }

  // There has to be at least one file in a gist.
  if (Object.keys(files).length === 0) {
    files['readme-0.md'] = {content: '.'}
  }

  // Create a Gist.
  const gistResult = await octo.gists.create({files})

  const {files: outputFiles, html_url: htmlUrl, id} = gistResult.data

  assert(outputFiles, 'expected `files` to be returned by GH')
  assert(htmlUrl, 'expected `html_url` to be returned by GH')
  assert(id, 'expected `id` to be returned by GH')

  /** @type {string} */
  let fileName

  for (fileName in outputFiles) {
    if (own.call(outputFiles, fileName)) {
      const info = outputFiles[fileName]
      const inputInfo = input[filenameToIndex[fileName]]
      // Fallback URL for the generated file if there are only comments.
      const inputUrl = (inputInfo || {}).inputUrl || new URL('about:blank')
      assert(info, 'expected `' + inputUrl.href + '` to be returned by github')
      assert(
        info.language === 'Markdown',
        'expected github seeing `' +
          inputUrl.href +
          '` as plain text data (markdown), instead it saw it as binary data; this is likely because there are weird characters (such as control characters or lone surrogates) in it'
      )
      // Note: not sure if this warning is needed.
      assert(
        !info.truncated,
        'expected github not truncating `' + inputUrl.href + '`'
      )
    }
  }

  index = -1
  while (++index < input.length) {
    const info = input[index]
    if (info.mode === 'comment') {
      await octo.gists.createComment({
        /* eslint-disable-next-line camelcase */
        gist_id: id,
        body: info.value
      })
    }
  }

  // Fetch the rendered page.
  const response = await fetch(htmlUrl, {
    headers: {Authorization: 'token ' + ghToken}
  })

  const document = await response.text()

  // Remove the Gist.
  /* eslint-disable-next-line camelcase */
  await octo.gists.delete({gist_id: id})

  const whole = rehype.parse(document)
  const fileNodes = selectAll('.file', whole)
  const commentNodes = selectAll('.comment-body.markdown-body', whole)
  /** @type {Array<string>} */
  const fileResults = []
  /** @type {Array<string>} */
  const commentResults = []

  index = -1
  while (++index < fileNodes.length) {
    const fileNode = fileNodes[index]
    const name = select('.gist-blob-name', fileNode)
    const body = select('.markdown-body', fileNode)
    assert(name, 'expected github file to have a name')
    const fileName = toString(name).trim()
    const match = /^\s*readme-(\d+)\.md\s*$/.exec(fileName)
    assert(match, 'expected gist file name to match `readme-\\d+.md`')
    const inputInfo = input[filenameToIndex[fileName]]
    // Fallback URL for the generated file if there are only comments.
    const inputUrl = (inputInfo || {}).inputUrl || new URL('about:blank')
    const fileIndex = Number.parseInt(match[1], 10)
    assert(
      body,
      'expected github to render body for ' +
        inputUrl +
        ', it didn’t; this is likely because there are weird characters (such as control characters or lone surrogates) in it'
    )
    fileResults[fileIndex] = rehype.stringify({
      type: 'root',
      children: body.children
    })
  }

  index = -1
  while (++index < commentNodes.length) {
    const body = commentNodes[index]

    const head = body.children.at(0)

    // GH renders some stray whitespace in comments.
    if (head && whitespace(head)) {
      body.children.splice(0, 1)
    }

    const tail = body.children.at(-1)

    if (tail && whitespace(tail)) {
      body.children.splice(-1, 1)
    }

    commentResults.push(
      rehype.stringify({type: 'root', children: body.children})
    )
  }

  index = -1

  let fileIndex = -1
  let commentIndex = -1

  while (++index < input.length) {
    const file = input[index]
    /** @type {string} */
    const result =
      file.mode === 'file'
        ? fileResults[++fileIndex]
        : commentResults[++commentIndex]
    let clean = String(await cleanMarkdownBody.process(result))

    if (clean && !/\n$/.test(clean)) {
      clean += '\n'
    }

    await fs.writeFile(file.outputUrl, clean)
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupSourcepos() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      // To do: wait, when was this needed again?
      /* c8 ignore next 6 */
      if (
        element.properties &&
        typeof element.properties.dataSourcepos === 'string'
      ) {
        delete element.properties.dataSourcepos
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
// eslint-disable-next-line unicorn/prevent-abbreviations
function cleanMarkupDir() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      if (element.properties && element.properties.dir === 'auto') {
        delete element.properties.dir
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupAnchor() {
  return (tree) => {
    visit(tree, 'element', (element, index, parent) => {
      if (
        parent &&
        typeof index === 'number' &&
        element.tagName === 'div' &&
        element.properties &&
        Array.isArray(element.properties.className) &&
        element.properties.className.includes('markdown-heading')
      ) {
        const first = element.children[0]
        const second = element.children[1]

        if (
          headingRank(first) &&
          first.type === 'element' &&
          first.properties &&
          Array.isArray(first.properties.className) &&
          first.properties.className.includes('heading-element') &&
          second &&
          second.type === 'element' &&
          second.properties &&
          Array.isArray(second.properties.className) &&
          second.properties.className.includes('anchor')
        ) {
          first.properties.className = first.properties.className.filter(
            (d) => d !== 'heading-element'
          )

          if (first.properties.className.length === 0) {
            first.properties.className = undefined
          }

          parent.children.splice(index, 1, first)
        }
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
// eslint-disable-next-line unicorn/prevent-abbreviations
function cleanMarkupLinkRel() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      // ```
      // <a href="..." rel="nofollow">...</a>
      // ```
      if (
        element.tagName === 'a' &&
        element.properties &&
        Array.isArray(element.properties.rel) &&
        element.properties.rel.includes('nofollow')
      ) {
        const {rel, ...rest} = element.properties
        element.properties = rest
      }
    })
  }
}

// https://github.blog/2010-11-13-sidejack-prevention-phase-3-ssl-proxied-assets/
// https://github.blog/2014-01-28-proxying-user-images/
// https://github.com/atmos/camo
// https://github.com/gjtorikian/html-pipeline/blob/main/lib/html/pipeline/camo_filter.rb#L23
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls
/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupCamoImage() {
  return (tree) => {
    visit(tree, 'element', (element, _, parent) => {
      // ```
      // <a
      //   target="_blank"
      //   rel="noopener noreferrer"
      //   href="https://camo.githubusercontent.com/70038f0093f5be2568e78034938192f04914dbfaf0484d428549d8a811942bd9/68747470733a2f2f627261766f2e636f6d"
      // >
      //   <img
      //     src="https://camo.githubusercontent.com/70038f0093f5be2568e78034938192f04914dbfaf0484d428549d8a811942bd9/68747470733a2f2f627261766f2e636f6d"
      //     alt="alpha"
      //     data-canonical-src="https://bravo.com"
      //     style="max-width: 100%;"
      //   >
      // </a>
      // ```
      if (
        element.tagName === 'img' &&
        element.properties &&
        element.properties.dataCanonicalSrc
      ) {
        const camo = element.properties.src
        const original = element.properties.dataCanonicalSrc
        element.properties.src = original
        delete element.properties.dataCanonicalSrc

        if (
          parent &&
          parent.type === 'element' &&
          parent.tagName === 'a' &&
          parent.properties &&
          parent.properties.href === camo
        ) {
          parent.properties.href = original
        }
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupImageStyle() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      // ```
      // <img src="lima" alt="kilo" style="max-width: 100%;">
      // ```
      if (
        element.tagName === 'img' &&
        element.properties &&
        typeof element.properties.style === 'string' &&
        /^\s*max-width:\s*100%;?\s*$/.test(element.properties.style)
      ) {
        delete element.properties.style
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupImageLink() {
  return (tree) => {
    visit(tree, 'element', (element, index, parent) => {
      // ```
      // <img src="lima" alt="kilo" style="max-width: 100%;">
      // ```
      if (
        matches('a[target=_blank]', element) &&
        element.properties &&
        parent &&
        typeof index === 'number' &&
        element.children.length === 1
        // To do: better test that this includes an image?
      ) {
        parent.children[index] = element.children[0]
        delete element.properties.target
        delete element.properties.rel
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupUserMention() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      // ```
      // <a
      //   class="user-mention"
      //   data-hovercard-type="user"
      //   data-hovercard-url="/users/wooorm/hovercard"
      //   data-octo-click="hovercard-link-click"
      //   data-octo-dimensions="link_type:self"
      //   href="https://github.com/wooorm"
      // >@wooorm</a>
      // ```
      if (matches('a.user-mention', element) && element.properties) {
        const {href} = element.properties
        element.properties = {href}
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupFootnoteIdHash() {
  const fields = ['href', 'id']

  return (tree) => {
    visit(tree, 'element', (element) => {
      // ```
      // <sup>
      //   <a
      //     href="#user-content-fn-1-15eeec68953e73b748987f03b6f5c0bd"
      //     id="user-content-fnref-1-15eeec68953e73b748987f03b6f5c0bd"
      //     data-footnote-ref=""
      //     aria-describedby="footnote-label"
      //   >1</a>
      // </sup>
      // ```
      if (
        matches(
          'a[data-footnote-ref], a.data-footnote-backref, li[id^=user-content-fn]',
          element
        ) &&
        element.properties
      ) {
        let index = -1
        while (++index < fields.length) {
          const field = fields[index]
          if (field in element.properties) {
            const value = element.properties[field]
            if (typeof value === 'string') {
              element.properties[field] = value.replace(/-[\da-f]{32}$/, '')
            }
          }
        }
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupTasklist() {
  return (tree) => {
    visit(tree, 'element', (element) => {
      // ```
      // <ul class="contains-task-list">
      // <li class="task-list-item"><input type="checkbox" id="" disabled class="task-list-item-checkbox" /> foo</li>
      // <li class="task-list-item"><input type="checkbox" id="" disabled class="task-list-item-checkbox" checked /> bar</li>
      // </ul>
      // ```
      if (
        matches(
          'ul.contains-task-list, li.task-list-item, input.task-list-item-checkbox',
          element
        ) &&
        element.properties
      ) {
        delete element.properties.className
        if (element.tagName === 'input') {
          delete element.properties.id
        }
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
function cleanMarkupFrontmatter() {
  return (tree) => {
    const head = tree.children[0]

    // ```
    // <table>
    //   <thead>
    //   <tr>
    //   <th>a</th>
    //   </tr>
    //   </thead>
    //   <tbody>
    //   <tr>
    //   <td><div>b</div></td>
    //   </tr>
    //   </tbody>
    // </table>
    // ```
    if (
      tree.children.length > 1 &&
      matches('markdown-accessiblity-table', head) &&
      select('table > tbody > tr > td > div', head) &&
      tree.children[1].type === 'text' &&
      tree.children[1].value === '\n\n'
    ) {
      tree.children.splice(0, 2)
    }
  }
}
