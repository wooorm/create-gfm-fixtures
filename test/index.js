import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {scheduler} from 'node:timers/promises'
import test from 'node:test'
import {createGfmFixtures} from 'create-gfm-fixtures'

test('create-gfm-fixtures', async function (t) {
  const fixtures = new URL('fixtures/', import.meta.url)

  await t.test('should expose the public api', async function () {
    assert.deepEqual(Object.keys(await import('create-gfm-fixtures')).sort(), [
      'createGfmFixtures'
    ])
  })

  await t.test('should work without files', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await createGfmFixtures(fixtures)
    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should work on a file', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('example.md', fixtures), 'a\nb')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('example.html', fixtures), 'utf8'),
      '<p>a\nb</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should work on a comment', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('example.comment.md', fixtures), 'a\nb')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('example.comment.html', fixtures), 'utf8'),
      '<p>a<br>\nb</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should not regenerate existing fixtures', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('example.md', fixtures), 'a\nb')
    await createGfmFixtures(fixtures)
    const statsBefore = await fs.stat(new URL('example.html', fixtures))

    await scheduler.wait(4)

    await createGfmFixtures(fixtures)

    const statsAfter = await fs.stat(new URL('example.html', fixtures))

    assert.equal(statsBefore.mtimeMs, statsAfter.mtimeMs)

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test(
    'should not generate fixtures for `offline` files',
    async function () {
      await fs.mkdir(fixtures, {recursive: true})
      await fs.writeFile(new URL('check.offline.md', fixtures), 'a')
      await createGfmFixtures(fixtures)

      let exists = false

      try {
        await fs.access(new URL('check.offline.html', fixtures))
        exists = true
      } catch {}

      assert.equal(exists, false)

      await fs.rm(fixtures, {recursive: true})
    }
  )

  await t.test('should support control pictures', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('control.md', fixtures), 'a␠␠\nb')
    await createGfmFixtures(fixtures, {controlPictures: true})

    assert.equal(
      await fs.readFile(new URL('control.html', fixtures), 'utf8'),
      '<p>a<br>\nb</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean `dir` attributes', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('dir.md', fixtures), 'a')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('dir.html', fixtures), 'utf8'),
      '<p>a</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean mentions', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('mention.file.md', fixtures), '@wooorm')
    await fs.writeFile(new URL('mention.comment.md', fixtures), '@wooorm')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('mention.file.html', fixtures), 'utf8'),
      '<p>@wooorm</p>\n',
      'should not support mentions in files'
    )

    assert.equal(
      await fs.readFile(new URL('mention.comment.html', fixtures), 'utf8'),
      '<p><a href="https://github.com/wooorm">@wooorm</a></p>\n',
      'should support mentions in comments'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean headings and their anchors', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('heading-anchor.md', fixtures), '# hi')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('heading-anchor.html', fixtures), 'utf8'),
      '<h1>hi</h1>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean footnotes', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('footnote.md', fixtures), '[^a]\n[^a]: b')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('footnote.html', fixtures), 'utf8'),
      '<p><sup><a href="#user-content-fn-a" id="user-content-fnref-a" data-footnote-ref="" aria-describedby="footnote-label">1</a></sup></p>\n<section data-footnotes="" class="footnotes"><h2 id="footnote-label" class="sr-only">Footnotes</h2>\n<ol>\n<li id="user-content-fn-a">\n<p>b <a href="#user-content-fnref-a" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean links', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(
      new URL('link.md', fixtures),
      '[alpha](https://bravo.com), [charlie](/delta), [echo](./foxtrot), [golf](?hotel), [india](#juliett).'
    )
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('link.html', fixtures), 'utf8'),
      '<p><a href="https://bravo.com">alpha</a>, <a href="/delta">charlie</a>, <a href="./foxtrot">echo</a>, <a href="?hotel">golf</a>, <a href="#juliett">india</a>.</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean images', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(
      new URL('image.md', fixtures),
      '![alpha](https://bravo.com), ![charlie](/delta), ![echo](./foxtrot), ![golf](?hotel), ![india](juliett?kilo), ![lima](#mike), ![oscar](papa#québec), [![sierra](tango)](uniform).'
    )
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('image.html', fixtures), 'utf8'),
      '<p><img src="https://bravo.com" alt="alpha">, <img src="/delta" alt="charlie">, <img src="./foxtrot" alt="echo">, <img src="" alt="golf">, <img src="juliett?kilo" alt="india">, <img src="" alt="lima">, <img src="papa#qu%C3%A9bec" alt="oscar">, <a href="uniform"><img src="tango" alt="sierra"></a>.</p>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean tasklists', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(new URL('tasklist.md', fixtures), '* [x] a')
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('tasklist.html', fixtures), 'utf8'),
      '<ul>\n<li><input type="checkbox" disabled checked> a</li>\n</ul>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })

  await t.test('should clean frontmatter', async function () {
    await fs.mkdir(fixtures, {recursive: true})
    await fs.writeFile(
      new URL('frontmatter.md', fixtures),
      '---\na: "b"\n---\n# c'
    )
    await createGfmFixtures(fixtures)

    assert.equal(
      await fs.readFile(new URL('frontmatter.html', fixtures), 'utf8'),
      '<h1>c</h1>\n'
    )

    await fs.rm(fixtures, {recursive: true})
  })
})
