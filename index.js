/**
 * @typedef {import('hast').Root} Root
 *
 * @typedef Options
 * @property {import('rehype-stringify').Options} [rehypeStringify]
 * @property {boolean} [controlPictures=false]
 */

import assert from 'node:assert'
import {promises as fs} from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'
import path from 'node:path'
import process from 'node:process'
import {Octokit} from '@octokit/rest'
import {controlPictures} from 'control-pictures'
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
 * @param {import('node:url').URL} url
 * @param {Options} [options={}]
 */
export async function createGfmFixtures(url, options = {}) {
  const rehype = unified().use(rehypeParse).use(rehypeStringify)

  const cleanMarkdownBody = unified()
    .use(rehypeParse, {fragment: true})
    .use(cleanMarkupDir)
    .use(cleanMarkupAnchor)
    .use(cleanMarkupLinkRel)
    .use(cleanMarkupCamoImage)
    .use(cleanMarkupImageStyle)
    .use(cleanMarkupImageLink)
    .use(cleanMarkupUserMention)
    .use(cleanMarkupGemoji)
    .use(cleanMarkupFootnoteIdHash)
    .use(cleanMarkupTasklist)
    .use(cleanMarkupFrontmatter)
    .use(rehypeStringify, options.rehypeStringify || {})

  const cwd = fileURLToPath(url)
  const filePaths = await globby(['**/*.md'], {cwd})
  const allInput = await Promise.all(
    filePaths.map(async (relative) => {
      const inputUrl = pathToFileURL(path.join(cwd, relative))
      const outputUrl = pathToFileURL(
        path.join(cwd, replaceExt(relative, '.html'))
      )
      let generate = true

      if (!process.env.UPDATE) {
        try {
          await fs.access(outputUrl)
          generate = false
        } catch {}
      }

      const last = path
        .basename(relative, path.extname(relative))
        .split('.')
        .pop()
      /** @type {'file'|'comment'} */
      const mode = last === 'comment' ? last : 'file'

      // C8 bug on Node 12.
      /* c8 ignore next 2 */
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

        // C8 bug on Node 12.
        /* c8 ignore next 2 */
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

  /** @type {Record<string, {content: string}>} */
  const files = {}
  let index = -1
  let fileInputIndex = 0
  while (++index < input.length) {
    const info = input[index]
    if (info.mode === 'file') {
      files['readme-' + fileInputIndex + '.md'] = {content: info.value}
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
      assert(info, 'expected `' + fileName + '` to be returned by github')
      assert(
        info.language === 'Markdown',
        'expected github seeing `' +
          fileName +
          '` as plain text data (markdown), instead it saw it as binary data; this is likely because there are weird characters (such as control characters or lone surrogates) in it'
      )
      // Note: not sure if this warning is needed.
      assert(
        !info.truncated,
        'expected github not truncating `' + fileName + '`'
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

  const doc = await response.text()

  // Remove the Gist.
  /* eslint-disable-next-line camelcase */
  await octo.gists.delete({gist_id: id})

  const whole = rehype.parse(doc)
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
    assert(
      body,
      'expected github to render body `' +
        index +
        '`, it didn’t; this is likely because there are weird characters (such as control characters or lone surrogates) in it'
    )
    const match = /^\s*readme-(\d+)\.md\s*$/.exec(toString(name))
    assert(match, 'expected gist file name to match `readme-\\d+.md`')
    const fileIndex = Number.parseInt(match[1], 10)
    fileResults[fileIndex] = rehype.stringify({
      type: 'root',
      children: body.children
    })
  }

  index = -1
  while (++index < commentNodes.length) {
    const body = commentNodes[index]

    // GH renders some stray whitespace in comments.
    if (whitespace(body.children[0])) {
      body.children.splice(0, 1)
    }

    if (whitespace(body.children[body.children.length - 1])) {
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
    visit(tree, 'element', (element) => {
      if (headingRank(element)) {
        const head = element.children[0]

        if (
          head &&
          head.type === 'element' &&
          head.properties &&
          Array.isArray(head.properties.className) &&
          head.properties.className.includes('anchor')
        ) {
          element.children.splice(0, 1)
        }
      }
    })
  }
}

/** @type {import('unified').Plugin<Array<void>, Root>} */
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
        index !== null &&
        element.children.length === 1
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
function cleanMarkupGemoji() {
  return (tree) => {
    visit(tree, 'element', (element, index, parent) => {
      // ```
      // <g-emoji
      //   class="g-emoji"
      //   alias="leftwards_arrow_with_hook"
      //   fallback-src="https://github.githubassets.com/images/icons/emoji/unicode/21a9.png"
      // >↩</g-emoji>
      // ```
      if (element.tagName === 'g-emoji' && parent && index !== null) {
        parent.children.splice(index, 1, ...element.children)
        return index
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
      tree.children.length > 2 &&
      matches('table', head) &&
      select('tbody > tr > td > div', head) &&
      tree.children[1].type === 'text' &&
      tree.children[1].value === '\n\n'
    ) {
      tree.children.splice(0, 2)
    }
  }
}
