import { describe, expect, it } from 'vitest'
import { nextNotesCursor, resolveNoteTitle, restoredVersionTitle } from './notes'

describe('editable note titles', () => {
  it('keeps the stored title when a content update omits title', () => {
    expect(resolveNoteTitle(undefined, 'Custom title')).toBe('Custom title')
  })

  it('allows clearing a title instead of deriving one from content', () => {
    expect(resolveNoteTitle('   ', 'Old title')).toBe('')
  })

  it('normalizes an explicitly entered title', () => {
    expect(resolveNoteTitle('  Project plan  ', 'Old title')).toBe('Project plan')
  })
})

describe('note version restoration', () => {
  it('restores the title saved with the version instead of deriving a different one', () => {
    expect(restoredVersionTitle('Custom saved title')).toBe('Custom saved title')
  })

  it('preserves an intentionally empty title', () => {
    expect(restoredVersionTitle('  ')).toBe('')
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
