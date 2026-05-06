"use client";

import ReactMarkdown from "react-markdown";

/**
 * MarkdownText — display-only renderer that preserves the app's
 * monospace, terminal-y aesthetic. Headings get bold + larger, lists
 * get hanging indents, bold/italic/code do the obvious thing. No
 * proportional fonts. No syntax highlighting.
 *
 * Edit mode (textarea) shows raw markdown — never use this component
 * inside an editable surface.
 *
 * Props:
 *   children — the markdown source text.
 *   className — outer wrapper class (defaults preserve font & wrap).
 */
export default function MarkdownText({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`whitespace-pre-wrap font-mono ${className}`}>
      <ReactMarkdown
        components={{
          // Headings — bold, slightly larger, no proportional font
          h1: ({ children }) => (
            <h1 className="text-base font-bold text-stone-100 mt-4 mb-2 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold text-stone-100 mt-3 mb-1.5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-stone-200 mt-2 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-stone-300 mt-2 mb-1 first:mt-0">
              {children}
            </h4>
          ),
          // Paragraphs — preserve current line height, no extra margin so
          // multiple paragraphs in a fragment don't push each other away
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          // Inline emphasis
          strong: ({ children }) => (
            <strong className="font-bold text-stone-100">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-stone-200">{children}</em>,
          // Code
          code: ({ children, ...props }) => {
            // ReactMarkdown distinguishes inline vs block code via the
            // `inline` prop on older versions; v9+ uses presence of
            // newlines / surrounding pre. Treat anything not in a `pre`
            // wrapper as inline.
            const text = String(children);
            const isBlock = text.includes("\n");
            return isBlock ? (
              <code className="block bg-stone-900 border border-stone-800 rounded px-2 py-1 my-2 text-stone-300" {...props}>
                {children}
              </code>
            ) : (
              <code className="bg-stone-900/70 px-1 rounded text-stone-200" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-outside ml-5 my-1 space-y-0.5 marker:text-stone-600">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside ml-5 my-1 space-y-0.5 marker:text-stone-600">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-stone-700 pl-3 my-2 text-stone-400 italic">
              {children}
            </blockquote>
          ),
          // Horizontal rule
          hr: () => <hr className="border-stone-800 my-3" />,
          // Links — open in new tab; use stone color so they don't
          // scream against the dark monospace look
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
