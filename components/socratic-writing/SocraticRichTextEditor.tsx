'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Pilcrow,
  Underline,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SocraticRichTextEditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (nextHtml: string) => void;
  className?: string;
  editorClassName?: string;
}

export type SocraticRichTextEditorHandle = {
  getHtml: () => string;
};

const SocraticRichTextEditor = forwardRef<SocraticRichTextEditorHandle, SocraticRichTextEditorProps>(function SocraticRichTextEditor({
  value,
  readOnly = false,
  onChange,
  className,
  editorClassName,
}, ref) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    getHtml: () => editorRef.current?.innerHTML || '',
  }), []);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const applyCommand = (command: string, commandValue?: string) => {
    if (readOnly) return;
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current?.innerHTML || '');
  };

  const toolbarButtons = [
    { label: 'Bold', icon: Bold, command: 'bold', value: undefined },
    { label: 'Italic', icon: Italic, command: 'italic', value: undefined },
    { label: 'Underline', icon: Underline, command: 'underline', value: undefined },
    { label: 'Paragraph', icon: Pilcrow, command: 'formatBlock', value: '<p>' },
    { label: 'Heading 1', icon: Heading1, command: 'formatBlock', value: '<h1>' },
    { label: 'Heading 2', icon: Heading2, command: 'formatBlock', value: '<h2>' },
    { label: 'Heading 3', icon: Heading3, command: 'formatBlock', value: '<h3>' },
    { label: 'Bulleted list', icon: List, command: 'insertUnorderedList', value: undefined },
    { label: 'Numbered list', icon: ListOrdered, command: 'insertOrderedList', value: undefined },
    { label: 'Align left', icon: AlignLeft, command: 'justifyLeft', value: undefined },
    { label: 'Align center', icon: AlignCenter, command: 'justifyCenter', value: undefined },
    { label: 'Align right', icon: AlignRight, command: 'justifyRight', value: undefined },
  ] as const;

  return (
    <div className={cn('w-full min-w-0 max-w-full overflow-hidden bg-white', className)}>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-0.5 overflow-x-hidden border-b border-gray-200 bg-white px-3 py-2">
        {toolbarButtons.map(({ label, icon: Icon, command, value: commandValue }, index) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyCommand(command, commandValue)}
            className={cn(
              'rounded-md p-2 text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40',
              (index === 3 || index === 7 || index === 9) && 'ml-1 border-l border-gray-200 pl-3',
            )}
            disabled={readOnly}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML || '')}
        className={cn(
          'min-h-[540px] w-full min-w-0 max-w-none overflow-x-hidden break-words px-12 py-10 outline-none prose prose-sm text-gray-900 [&_*]:max-w-full',
          'empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]',
          readOnly && 'bg-gray-50 text-gray-700',
          editorClassName,
        )}
        data-placeholder="Start writing your essay here..."
      />
    </div>
  );
});

export default SocraticRichTextEditor;
