import {promises as fs} from 'node:fs'
import test from 'tape'
import {createGfmFixtures} from '../index.js'

test('create-gfm-fixtures', async (t) => {
  const fixtures = new URL('fixtures/', import.meta.url)
  await fs.mkdir(fixtures, {recursive: true})

  // Test coverage: nothing happens w/o files.
  await createGfmFixtures(fixtures)

  // Test: basic case.
  await fs.writeFile(new URL('example.md', fixtures), 'a\nb')
  await fs.writeFile(new URL('example.comment.md', fixtures), 'a\nb')

  await createGfmFixtures(fixtures)

  t.equal(
    String(await fs.readFile(new URL('example.html', fixtures))),
    '<p>a\nb</p>\n',
    'should crawl html (file)'
  )
  t.equal(
    String(await fs.readFile(new URL('example.comment.html', fixtures))),
    '<p>a<br>\nb</p>\n',
    'should crawl html (comment)'
  )

  // Test: No need to regenerate.
  const statsBefore = await fs.stat(new URL('example.html', fixtures))

  await createGfmFixtures(fixtures)

  const statsAfter = await fs.stat(new URL('example.html', fixtures))

  t.equal(
    statsBefore.mtimeMs,
    statsAfter.mtimeMs,
    'should not modify existing files'
  )

  // Done.
  console.log(
    '\nnote: the next warning is expected (remove when node 12 is EOL)'
  )
  await fs.rmdir(fixtures, {recursive: true})
  console.log(
    'note: the prev warning was expected (remove when node 12 is EOL)\n'
  )

  // Test: comment only should work
  await fs.mkdir(fixtures, {recursive: true})
  await fs.writeFile(new URL('example.comment.md', fixtures), 'a\nb')

  await createGfmFixtures(fixtures)

  t.equal(
    String(await fs.readFile(new URL('example.comment.html', fixtures))),
    '<p>a<br>\nb</p>\n',
    'should crawl w/ just comments'
  )

  await fs.rmdir(fixtures, {recursive: true})

  // Test: control pictures
  await fs.mkdir(fixtures, {recursive: true})
  await fs.writeFile(new URL('control.md', fixtures), 'a␠␠\nb')

  await createGfmFixtures(fixtures, {controlPictures: true})

  t.equal(
    String(await fs.readFile(new URL('control.html', fixtures))),
    '<p>a<br>\nb</p>\n',
    'should crawl w/ `controlPictures`'
  )

  await fs.rmdir(fixtures, {recursive: true})

  // Test: cleaning:
  await fs.mkdir(fixtures, {recursive: true})
  await fs.writeFile(new URL('dir.md', fixtures), 'a')
  await fs.writeFile(new URL('mention.file.md', fixtures), '@wooorm')
  await fs.writeFile(new URL('mention.comment.md', fixtures), '@wooorm')
  await fs.writeFile(new URL('heading-anchor.md', fixtures), '# hi')
  await fs.writeFile(new URL('emoji.md', fixtures), '✅')
  await fs.writeFile(new URL('footnote.md', fixtures), '[^a]\n[^a]: b')
  await fs.writeFile(
    new URL('link.md', fixtures),
    '[alpha](https://bravo.com), [charlie](/delta), [echo](./foxtrot), [golf](?hotel), [india](#juliett).'
  )
  await fs.writeFile(
    new URL('image.md', fixtures),
    '![alpha](https://bravo.com), ![charlie](/delta), ![echo](./foxtrot), ![golf](?hotel), ![india](juliett?kilo), ![lima](#mike), ![oscar](papa#québec), [![sierra](tango)](uniform).'
  )
  await fs.writeFile(new URL('tasklist.md', fixtures), '* [x] a')
  await fs.writeFile(
    new URL('frontmatter.md', fixtures),
    '---\na: "b"\n---\n# c'
  )

  await createGfmFixtures(fixtures)

  t.equal(
    String(await fs.readFile(new URL('dir.html', fixtures))),
    '<p>a</p>\n',
    'should clean `dir` attributes'
  )

  t.equal(
    String(await fs.readFile(new URL('mention.file.html', fixtures))),
    '<p>@wooorm</p>\n',
    'should clean mentions (1, not supported in files)'
  )
  t.equal(
    String(await fs.readFile(new URL('mention.comment.html', fixtures))),
    '<p><a href="https://github.com/wooorm">@wooorm</a></p>\n',
    'should clean mentions (2, supported in files)'
  )

  t.equal(
    String(await fs.readFile(new URL('heading-anchor.html', fixtures))),
    '<h1>hi</h1>\n',
    'should clean heading (link-to-self and anchor icon)'
  )

  t.equal(
    String(await fs.readFile(new URL('link.html', fixtures))),
    '<p><a href="https://bravo.com">alpha</a>, <a href="/delta">charlie</a>, <a href="./foxtrot">echo</a>, <a href="?hotel">golf</a>, <a href="#juliett">india</a>.</p>\n',
    'should clean links'
  )

  t.equal(
    String(await fs.readFile(new URL('image.html', fixtures))),
    '<p><img src="https://bravo.com" alt="alpha">, <img src="/delta" alt="charlie">, <img src="./foxtrot" alt="echo">, <img src="" alt="golf">, <img src="juliett?kilo" alt="india">, <img src="" alt="lima">, <img src="papa#qu%C3%A9bec" alt="oscar">, <a href="uniform"><img src="tango" alt="sierra"></a>.</p>\n',
    'should clean images'
  )

  t.equal(
    String(await fs.readFile(new URL('emoji.html', fixtures))),
    '<p>✅</p>\n',
    'should clean emoji'
  )

  t.equal(
    String(await fs.readFile(new URL('footnote.html', fixtures))),
    '<p><sup><a href="#user-content-fn-a" id="user-content-fnref-a" data-footnote-ref="" aria-describedby="footnote-label">1</a></sup></p>\n<section data-footnotes="" class="footnotes"><h2 id="footnote-label" class="sr-only">Footnotes</h2>\n<ol>\n<li id="user-content-fn-a">\n<p>b <a href="#user-content-fnref-a" data-footnote-backref="" aria-label="Back to content" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>\n',
    'should clean footnotes'
  )

  t.equal(
    String(await fs.readFile(new URL('tasklist.html', fixtures))),
    '<ul>\n<li><input type="checkbox" disabled checked> a</li>\n</ul>\n',
    'should clean tasklists'
  )

  t.equal(
    String(await fs.readFile(new URL('frontmatter.html', fixtures))),
    '<h1>c</h1>\n',
    'should clean frontmatter'
  )

  await fs.rmdir(fixtures, {recursive: true})

  t.end()
})
