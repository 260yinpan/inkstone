import { describe, expect, it } from 'vitest'
import { nextNotesCursor, restoredVersionTitle } from './notes'

describe('note version restoration', () => {
  it('restores the title saved with the version instead of deriving a different one', () => {
    expect(restoredVersionTitle('Custom saved title', '# Heading from content')).toBe('Custom saved title')
  })

  it('derives a title only for an empty legacy version title', () => {
    expect(restoredVersionTitle('  ', '# Heading from content')).toBe('Heading from content')
  })
})

describe('note list pagination', () => {
  it('does not advertise an empty page after an exactly full final page', () => {
    expect(nextNotesCursor(0, 50, 50)).toBeNull()
    expect(nextNotesCursor(50, 50, 100)).toBeNull()
  })

  it('advances by the rows actually returned while more rows remain', () => {
    expect(nextNotesCursor(20, 30, 75)).toBe('50')
    expect(nextNotesCursor(20, 0, 75)).toBeNull()
  })
})
