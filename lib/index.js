/**
 * @import {Root} from 'hast'
 * @import {Options as ToHtmlOptions} from 'hast-util-to-html'
 */

/**
 * @typedef Keep
 *   Keep certain parts of GHs pipelines (default: `false`).
 * @property {boolean | null | undefined} [camo=false]
 *   Keep `camo.githubusercontent.com` on images (default: `false`).
 * @property {boolean | null | undefined} [dir=false]
 *   Keep `dir="auto"` (default: `false`).
 * @property {boolean | null | undefined} [frontmatter=false]
 *   Keep visible frontmatter (default: `false`).
 * @property {boolean | null | undefined} [heading=false]
 *   Keep `.anchor` in headings (default: `false`).
 * @property {boolean | null | undefined} [image=false]
 *   Keep `max-width:100%` on images and `a[target=_blank]` parent wrapper
 *   (default: `false`).
 * @property {boolean | null | undefined} [issue=false]
 *   Keep `.issue-link`s (default: `false`).
 * @property {boolean | null | undefined} [link=false]
 *   Keep `rel="nofollow"` on links (default: `false`).
 * @property {boolean | null | undefined} [mention=false]
 *   Keep attributes on `.user-mention`s (default: `false`).
 * @property {boolean | null | undefined} [table=false]
 *   Keep the `markdown-accessiblity-table` custom element
 *   around tables (default: `false`).
 * @property {boolean | null | undefined} [tasklist=false]
 *   Keep classes on tasklist-related elements and `id` on their inputs
 *   (default: `false`).
 *
 * @typedef Options
 *   Configuration (optional).
 * @property {boolean | null | undefined} [controlPictures=false]
 *   Handle control pictures (default: `false`).
 * @property {Keep | null | undefined} [keep]
 *   Keep certain parts of GHs pipeline (optional).
 * @property {ToHtmlOptions | null | undefined} [toHtml]
 *   Configuration passed to `hast-util-to-html` (optional).
 *
 * @callback Transform
 *   Transform.
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {Octokit} from '@octokit/rest'
import {controlPictures} from 'control-pictures'
// To do: use `fsPromises.glob` when Node 22 is minimum.
import {globby} from 'globby'
import {fromHtmlIsomorphic} from 'hast-util-from-html-isomorphic'
import {headingRank} from 'hast-util-heading-rank'
import {matches, selectAll, select} from 'hast-util-select'
import {toHtml} from 'hast-util-to-html'
import {toString} from 'hast-util-to-string'
import {whitespace} from 'hast-util-whitespace'
import replaceExt from 'replace-ext'
import {fetch} from 'undici'
import {visit} from 'unist-util-visit'

/**
 * Clean the `.anchor` link added to headings.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupAnchor(tree) {
  visit(tree, 'element', function (element, index, parent) {
    if (
      parent &&
      typeof index === 'number' &&
      element.tagName === 'div' &&
      Array.isArray(element.properties.className) &&
      element.properties.className.includes('markdown-heading')
    ) {
      const first = element.children[0]
      const second = element.children[1]

      if (
        headingRank(first) &&
        first.type === 'element' &&
        Array.isArray(first.properties.className) &&
        first.properties.className.includes('heading-element') &&
        second &&
        second.type === 'element' &&
        Array.isArray(second.properties.className) &&
        second.properties.className.includes('anchor')
      ) {
        first.properties.className = first.properties.className.filter(
          function (d) {
            return d !== 'heading-element'
          }
        )

        if (first.properties.className.length === 0) {
          first.properties.className = undefined
        }

        parent.children.splice(index, 1, first)
      }
    }
  })
}

/**
 * Clean the camo URLs that GH uses for images.
 *
 * See:
 *
 * * <https://github.blog/2010-11-13-sidejack-prevention-phase-3-ssl-proxied-assets/>
 * * <https://github.blog/2014-01-28-proxying-user-images/>
 * * <https://github.com/atmos/camo>
 * * <https://github.com/gjtorikian/html-pipeline/blob/main/lib/html/pipeline/camo_filter.rb#L23>
 * * <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls>
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupCamoImage(tree) {
  visit(tree, 'element', function (element, _, parent) {
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
    if (element.tagName === 'img' && element.properties.dataCanonicalSrc) {
      const camo = element.properties.src
      const original = element.properties.dataCanonicalSrc
      element.properties.src = original
      delete element.properties.dataCanonicalSrc

      if (
        parent &&
        parent.type === 'element' &&
        parent.tagName === 'a' &&
        parent.properties.href === camo
      ) {
        parent.properties.href = original
      }
    }
  })
}

/**
 * Clean `.issue-link` hovercards.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupIssue(tree) {
  visit(tree, 'element', function (element, index, parent) {
    // ```markdown
    // wooorm/linked-list#1
    // ```
    //
    // into:
    //
    // ```html
    // <a
    //   class="issue-link js-issue-link"
    //   data-error-text="Failed to load title"
    //   data-id="189266337"
    //   data-permission-text="Title is private"
    //   data-url="https://github.com/wooorm/linked-list/issues/1"
    //   data-hovercard-type="pull_request"
    //   data-hovercard-url="/wooorm/linked-list/pull/1/hovercard"
    //   href="https://github.com/wooorm/linked-list/pull/1"
    // >
    //   wooorm/linked-list#1
    // </a>
    // ```
    if (
      parent &&
      typeof index === 'number' &&
      element.tagName === 'a' &&
      Array.isArray(element.properties.className) &&
      element.properties.className.includes('issue-link')
    ) {
      parent.children.splice(index, 1, ...element.children)
    }
    // ```markdown
    // [issue](https://github.com/wooorm/linked-list/issues/7)
    // ```
    //
    // into:
    //
    // ```html
    // <a
    //   href="https://github.com/wooorm/linked-list/issues/7"
    //   data-hovercard-type="issue"
    //   data-hovercard-url="/wooorm/linked-list/issues/7/hovercard"
    // >issue</a>
    // ```
    else if (
      parent &&
      typeof index === 'number' &&
      element.tagName === 'a' &&
      (element.properties.dataHovercardType === 'issue' ||
        element.properties.dataHovercardType === 'pull_request')
    ) {
      element.properties.dataHovercardType = undefined
      element.properties.dataHovercardUrl = undefined
    }
  })
}

/**
 * Clean the `dir` attribute that’s set.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
// eslint-disable-next-line unicorn/prevent-abbreviations
function cleanMarkupDir(tree) {
  visit(tree, 'element', function (element) {
    if (element.properties.dir === 'auto') {
      delete element.properties.dir
    }
  })
}

/**
 * Clean the markup added for footnotes per comment.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupFootnoteIdHash(tree) {
  const fields = ['href', 'id']

  visit(tree, 'element', function (element) {
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
      )
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

/**
 * Clean the table that GH generates from frontmatter.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupFrontmatter(tree) {
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

/**
 * Clean the `a` added around images.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupImageLink(tree) {
  visit(tree, 'element', function (element, index, parent) {
    // ```
    // <img src="lima" alt="kilo" style="max-width: 100%;">
    // ```
    if (
      matches('a[target=_blank]', element) &&
      parent &&
      typeof index === 'number' &&
      element.children.length === 1
    ) {
      const child = element.children[0]

      if (child && child.type === 'element' && child.tagName === 'img') {
        parent.children[index] = child
        delete element.properties.target
        delete element.properties.rel
      }
    }
  })
}

/**
 * Clean the `style` added to images.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupImageStyle(tree) {
  visit(tree, 'element', function (element) {
    // ```
    // <img src="lima" alt="kilo" style="max-width: 100%;">
    // ```
    if (
      element.tagName === 'img' &&
      typeof element.properties.style === 'string' &&
      /^\s*max-width:\s*100%;?\s*$/.test(element.properties.style)
    ) {
      delete element.properties.style
    }
  })
}

/**
 * Clean the `rel` attribute that’s set.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
// eslint-disable-next-line unicorn/prevent-abbreviations
function cleanMarkupLinkRel(tree) {
  visit(tree, 'element', function (element) {
    // ```
    // <a href="..." rel="nofollow">...</a>
    // ```
    if (
      element.tagName === 'a' &&
      Array.isArray(element.properties.rel) &&
      element.properties.rel.includes('nofollow')
    ) {
      const {rel, ...rest} = element.properties
      element.properties = rest
    }
  })
}

/**
 * Clean the table that GH generates from frontmatter.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupTable(tree) {
  visit(tree, 'element', function (node, index, parent) {
    if (
      typeof index === 'number' &&
      parent &&
      node.tagName === 'markdown-accessiblity-table'
    ) {
      parent.children.splice(index, 1, ...node.children)
    }
  })
}

/**
 * Clean the markup added for tasklists.
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupTasklist(tree) {
  visit(tree, 'element', function (element) {
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
      )
    ) {
      delete element.properties.className

      if (element.tagName === 'input') {
        delete element.properties.id
      }
    }
  })
}

/**
 * Clean the markup added for mentions.
 *
 * @param {Root} tree
 *   Tree.
 * @returns {undefined}
 *   Nothing.
 */
function cleanMarkupUserMention(tree) {
  visit(tree, 'element', function (element) {
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
    if (matches('a.user-mention', element)) {
      const {href} = element.properties
      element.properties = {href}
    }
  })
}

/**
 * Finds markdown files in `url` and generates HTML files for them if they’re
 * a) missing or b) `UPDATE` is in env.
 *
 * @param {Readonly<URL>} url
 *   URL to folder with fixtures.
 * @param {Readonly<Options> | null | undefined} [options]
 *   Configuration (optional).
 * @returns {Promise<undefined>}
 *   Promise to nothing.
 */
export async function createGfmFixtures(url, options) {
  const settings = options || {}
  const keep = settings.keep || {}
  /** @type {Array<Transform>} */
  const transforms = []

  if (!keep.camo) transforms.push(cleanMarkupCamoImage)
  if (!keep.dir) transforms.push(cleanMarkupDir)
  if (!keep.frontmatter) transforms.push(cleanMarkupFrontmatter)
  if (!keep.heading) transforms.push(cleanMarkupAnchor)
  if (!keep.image) transforms.push(cleanMarkupImageStyle, cleanMarkupImageLink)
  if (!keep.issue) transforms.push(cleanMarkupIssue)
  if (!keep.link) transforms.push(cleanMarkupLinkRel)
  if (!keep.mention) transforms.push(cleanMarkupUserMention)
  transforms.push(cleanMarkupFootnoteIdHash)
  if (!keep.table) transforms.push(cleanMarkupTable)
  if (!keep.tasklist) transforms.push(cleanMarkupTasklist)

  const cwd = fileURLToPath(url)
  const filePaths = await globby(['**/*.md'], {cwd})
  const allInput = await Promise.all(
    filePaths.map(async function (relative) {
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
      /** @type {'comment' | 'file'} */
      const mode = last === 'comment' ? last : 'file'

      return {generate, inputUrl, mode, outputUrl}
    })
  )

  const input = await Promise.all(
    allInput
      .filter(function (d) {
        return d.generate
      })
      .map(async function ({generate, ...d}) {
        let value = String(await fs.readFile(d.inputUrl))

        if (settings.controlPictures) {
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
    if (Object.hasOwn(outputFiles, fileName)) {
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

  const whole = fromHtmlIsomorphic(document)
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
    fileResults[fileIndex] = toHtml({
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

    commentResults.push(toHtml({type: 'root', children: body.children}))
  }

  index = -1

  let fileIndex = -1
  let commentIndex = -1

  while (++index < input.length) {
    const file = input[index]
    const result =
      file.mode === 'file'
        ? fileResults[++fileIndex]
        : commentResults[++commentIndex]
    const tree = fromHtmlIsomorphic(result, {fragment: true})

    for (const transform of transforms) {
      transform(tree)
    }

    let clean = toHtml(tree, settings.toHtml)

    if (clean && !/\n$/.test(clean)) {
      clean += '\n'
    }

    await fs.writeFile(file.outputUrl, clean)
  }
}
