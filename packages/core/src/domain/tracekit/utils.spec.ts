import { getFileFromStackTraceString } from './utils'

describe('getFileFromStackTraceString', () => {
  it('should get the first source file of the stack', () => {
    expect(
      getFileFromStackTraceString(`TypeError: oh snap!
    at foo(1, bar) @ http://path/to/file.js:52:15
    at <anonymous> @ http://path/to/file.js:12
    at <anonymous>(baz) @ http://path/to/file.js`)
    ).toEqual('http://path/to/file.js:52:15')
  })

  it('should get undefined if no source file is in the stack', () => {
    expect(getFileFromStackTraceString('TypeError: oh snap!')).not.toBeDefined()
  })
})
