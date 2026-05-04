// JavaScriptEditor.tsx
//
// Monaco-backed editor for JavaScript post-processor code. Used both inline in
// the side panel and inside the expanded dialog. Saving is debounced (300 ms)
// so we don't flood the Zustand store on every keystroke; any pending edit is
// flushed when the editor unmounts so no work is lost when the user closes the
// dialog or switches nodes.

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useThemeStore } from '@/store/themeStore'

export interface JavaScriptEditorHandle {
  /** Force any pending debounced change to commit immediately. */
  flush: () => void
}

interface JavaScriptEditorProps {
  value: string
  onChange: (next: string) => void
  height?: string | number
  readOnly?: boolean
  className?: string
  /** Debounce window in ms before onChange fires. Default 300. */
  debounceMs?: number
}

export const JavaScriptEditor = forwardRef<JavaScriptEditorHandle, JavaScriptEditorProps>(
  function JavaScriptEditor(
    { value, onChange, height = 220, readOnly, className, debounceMs = 300 },
    ref
  ) {
    const mode = useThemeStore((s) => s.mode)
    const [draft, setDraft] = useState(value)
    const draftRef = useRef(draft)
    const onChangeRef = useRef(onChange)
    const lastCommittedRef = useRef(value)
    const timerRef = useRef<number | null>(null)

    // Keep refs in sync so the unmount flush always sees the latest values.
    useEffect(() => {
      draftRef.current = draft
    }, [draft])
    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    // External value changed (e.g. saved query loaded, undo, dialog opened with
    // fresh value). Adopt it as the new baseline — but only if the user hasn't
    // got an unflushed edit ahead of it.
    useEffect(() => {
      if (value !== lastCommittedRef.current && value !== draftRef.current) {
        setDraft(value)
        lastCommittedRef.current = value
      }
    }, [value])

    const flush = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const pending = draftRef.current
      if (pending !== lastCommittedRef.current) {
        lastCommittedRef.current = pending
        onChangeRef.current(pending)
      }
    }

    useImperativeHandle(ref, () => ({ flush }), [])

    // Flush on unmount so closing the dialog or switching nodes never loses work.
    useEffect(() => {
      return () => {
        flush()
      }
    }, [])

    const handleChange = (next: string | undefined) => {
      const nextValue = next ?? ''
      setDraft(nextValue)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (draftRef.current !== lastCommittedRef.current) {
          lastCommittedRef.current = draftRef.current
          onChangeRef.current(draftRef.current)
        }
      }, debounceMs) as unknown as number
    }

    const handleMount: OnMount = (editor) => {
      // Cmd/Ctrl+S inside the editor triggers an immediate flush so users with
      // muscle memory get a synchronous save before the host dialog handles it.
      editor.addCommand(
        2048 /* KeyMod.CtrlCmd */ | 49 /* KeyCode.KeyS */,
        () => flush()
      )
    }

    return (
      <div className={className}>
        <Editor
          height={height}
          language="javascript"
          theme={mode === 'dark' ? 'vs-dark' : 'light'}
          value={draft}
          onChange={handleChange}
          onMount={handleMount}
          loading={
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Loading editor…
            </div>
          }
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
            readOnly,
            fixedOverflowWidgets: true,
            renderLineHighlight: 'all',
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
          }}
        />
      </div>
    )
  }
)
