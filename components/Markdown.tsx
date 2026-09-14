'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ value, className = '' }: { value: string; className?: string }) {
  return (
    <div className={`markdown-content min-w-0 max-w-full text-sm leading-relaxed text-gray-700 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table-scroll mb-3 max-w-full overflow-x-auto rounded-lg">
              <table {...props} />
            </div>
          ),
        }}
      >
        {value || ''}
      </ReactMarkdown>
    </div>
  );
}
