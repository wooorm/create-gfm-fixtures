# create-gfm-fixtures

[![Build][build-badge]][build]
[![Coverage][coverage-badge]][coverage]
[![Downloads][downloads-badge]][downloads]
[![Size][size-badge]][size]

Create GFM fixtures.

## Contents

*   [What is this?](#what-is-this)
*   [When should I use this?](#when-should-i-use-this)
*   [Install](#install)
*   [Use](#use)
*   [API](#api)
    *   [`createGfmFixtures(url[, options])`](#creategfmfixturesurl-options)
*   [Types](#types)
*   [Compatibility](#compatibility)
*   [Security](#security)
*   [Contribute](#contribute)
*   [License](#license)

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
In Node.js (version 12.20+, 14.14+, or 16.0+), install with [npm][]:

```sh
npm install micromark-extension-gfm-footnote
```

## Use

```js
import {promises as fs} from 'node:fs'
import test from 'tape'
import {createGfmFixtures} from 'create-gfm-fixtures'

test('fixtures', async (t) => {
  const input = await fs.readFile(new URL('url/to/fixtures/example.md'))

  await createGfmFixtures(new URL('url/to/fixtures/'))

  // Now the corresponding HTML is generated.
  const expected = await fs.readFile(new URL('url/to/fixtures/example.html'))

  t.equal('<h1>hi</h1>', expected)
})
```

## API

This package exports the following identifiers: `createGfmFixtures`.
There is no default export.

### `createGfmFixtures(url[, options])`

Finds all markdown files (`**/*.md`) inside `url` (`URL`, not path), and
generates HTML files for them if they’re either a) missing, b) `UPDATE` is set
in env.

###### `options`

Configuration (optional).

###### `options.rehypeStringify`

Options passed to [`rehype-stringify`][rehype-stringify] (`Object?`).

###### `options.controlPictures`

Whether to allow [`control-pictures`][control-pictures] in markdown and replace
them with the control characters they represent before sending it off to GitHub
(`boolean`, default: `false`).

###### Configuration from files

End markdown files with `file.md` or `comment.md` to choose whether to crawl as
markdown files or as comments.
The default is to use “file”.

###### Configuration from env

*   pass `UPDATE=1` (any truthy value will do) to regenerate fixtures
*   place a `GH_TOKEN` or `GITHUB_TOKEN` in env when generating files,
    this token needs a `gist` (Create gists) scope

## Types

This package is fully typed with [TypeScript][].
It exports additional `Options` type that models its respective interface.

## Compatibility

This package is at least compatible with all maintained versions of Node.js.
As of now, that is Node.js 12.20+, 14.14+, and 16.0+.

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

[downloads-badge]: https://img.shields.io/npm/dm/create-gfm-fixtures.svg

[downloads]: https://www.npmjs.com/package/create-gfm-fixtures

[size-badge]: https://img.shields.io/bundlephobia/minzip/create-gfm-fixtures.svg

[size]: https://bundlephobia.com/result?p=create-gfm-fixtures

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
