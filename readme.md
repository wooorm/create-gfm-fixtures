# create-gfm-fixtures

[![Build][build-badge]][build]
[![Coverage][coverage-badge]][coverage]

Create GFM fixtures.

## Contents

* [What is this?](#what-is-this)
* [When should I use this?](#when-should-i-use-this)
* [Install](#install)
* [Use](#use)
* [API](#api)
  * [`createGfmFixtures(url[, options])`](#creategfmfixturesurl-options)
  * [`Options`](#options)
  * [`Keep`](#keep)
* [Types](#types)
* [Compatibility](#compatibility)
* [Security](#security)
* [Contribute](#contribute)
* [License](#license)

## What is this?

This is a small tool you can use in tests, with some markdown fixtures, and
it’ll crawl the HTML that github.com generates for each fixture.

The problem this solves is that GitHub uses varying closed-source algorithms to
turn markdown into HTML.
Notably, there are differences between markdown files in repos, gists, comments
(including issue and PR posts), and their [`/markdown` endpoint][endpoint].
These algos are also all different from their documentation (e.g., [GFM][],
[Writing on GitHub][])
Some of these are documented while others have to be reverse engineered.
This project helps with the reverse engineering.

GitHub also adds a bunch of “stuff” to user content they render, such as
`dir="auto"` on each element.
This project tries to revert those things that are more specific to `github.com`,
attempting to uncover the functionality that matches their core markdown
implementation instead.
In some cases, it is possible in markdown to embed HTML that matches what GitHub
would create.
The different cleaning tasks here cannot distinguish between GitHub and users,
and due to this, it’s not possible to use this project to figure out how GitHub
handles HTML in markdown.

## When should I use this?

When you’re making markdown parsers (as in, [`micromark`][micromark] or
extensions to it).

## Install

This package is [ESM only][esm].
In Node.js (version 18+), install with [npm][]:

```sh
npm install create-gfm-fixtures
```

## Use

```js
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import {createGfmFixtures} from 'create-gfm-fixtures'

test('fixtures', async function () {
  const fixtures = new URL('url/to/fixtures/')
  const input = await fs.readFile(new URL('example.md', fixtures))
  // ^-- This is our input to some process.

  await createGfmFixtures(fixtures)

  // Now the corresponding HTML is generated.
  const expected = await fs.readFile(new URL('example.html', fixtures))

  assert.equal('<h1>hi</h1>', expected)
  // ^-- Assume this `string` is somehow generated from `input`.
})
```

## API

This package exports the identifier `createGfmFixtures`.
There is no default export.

### `createGfmFixtures(url[, options])`

Finds all markdown files (`**/*.md`) inside `url` and generates HTML files for
them if they’re either a) missing, b) `UPDATE` is set in env.

###### Parameters

* `url` (`URL`) — URL to folder containing fixtures
* `options` (`Options`) — configuration (optional)

###### Returns

Promise that resolves when done (`Promise<undefined>`).

###### Configuration from files

End markdown files with `file.md` or `comment.md` to choose whether to crawl as
markdown files or as comments.
The default is to use “file”.

Include `offline` in a filename stem part (split on `.`) to never send a
fixture to GitHub and generate HTML for it.

###### Configuration from env

* pass `UPDATE=1` (any truthy value will do) to regenerate fixtures
* place a `GH_TOKEN` or `GITHUB_TOKEN` in env when generating files,
  this token needs a `gist` (Create gists) scope

### `Options`

Configuration (`Object`, optional) with the following fields:

###### `options.rehypeStringify`

Options passed to [`rehype-stringify`][rehype-stringify] (`Object`, optional).

###### `options.controlPictures`

Whether to allow [`control-pictures`][control-pictures] in markdown and replace
them with the control characters they represent before sending it off to GitHub
(`boolean`, default: `false`).

###### `options.keep`

Parts of the pipeline to keep (`Keep`, optional).

### `Keep`

Keep certain parts of GHs pipeline (`Object`, optional) with the following
fields:

###### `keep.dir`

Keep `dir="auto"` (`boolean`, default: `false`).

###### `keep.heading`

Keep `.anchor` in headings (`boolean`, default: `false`).

###### `keep.link`

Keep `rel="nofollow"` on links (`boolean`, default: `false`).

###### `keep.camo`

Keep `camo.githubusercontent.com` on images (`boolean`, default: `false`).

###### `keep.image`

Keep `max-width:100%` on images and `a[target=_blank]` parent wrapper
(`boolean`, default: `false`).

###### `keep.mention`

Keep attributes on `.user-mention`s (`boolean`, default: `false`).

###### `keep.tasklist`

Keep classes on tasklist-related elements, and `id` on their inputs
(`boolean`, default: `false`).

###### `keep.frontmatter`

Keep visible frontmatter (`boolean`, default: `false`).

## Types

This package is fully typed with [TypeScript][].
It exports the additional types `Options` and `Keep`.

## Compatibility

This package is at least compatible with all maintained versions of Node.js.
As of this writing, that is Node.js 18+.

## Security

Assuming you trust the markdown files in your repo, this package is safe.

## Contribute

Yes please!
See [How to Contribute to Open Source][contribute].

## License

[MIT][license] © [Titus Wormer][author]

<!-- Definitions -->

[build-badge]: https://github.com/wooorm/create-gfm-fixtures/workflows/main/badge.svg

[build]: https://github.com/wooorm/create-gfm-fixtures/actions

[coverage-badge]: https://img.shields.io/codecov/c/github/wooorm/create-gfm-fixtures.svg

[coverage]: https://codecov.io/github/wooorm/create-gfm-fixtures

[npm]: https://docs.npmjs.com/cli/install

[license]: license

[author]: https://wooorm.com

[esm]: https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c

[typescript]: https://www.typescriptlang.org

[contribute]: https://opensource.guide/how-to-contribute/

[endpoint]: https://docs.github.com/en/rest/reference/markdown

[micromark]: https://github.com/micromark/micromark

[gfm]: https://github.github.com/gfm/

[writing on github]: https://docs.github.com/en/github/writing-on-github

[rehype-stringify]: https://github.com/rehypejs/rehype/tree/main/packages/rehype-stringify

[control-pictures]: https://github.com/wooorm/control-pictures
