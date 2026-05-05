"use client";

import { useRef, useEffect, useState } from "react";
import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from "@chenglou/pretext";

interface PositionedWord {
  text: string;
  x: number;
  y: number;
  width: number;
  lineIndex: number;
}

interface WordLevelContentProps {
  content: string;
  onContentChange?: (newContent: string) => void;
  containerWidth?: number;
  obstacles?: { x: number; y: number; w: number; h: number }[];
  dragPosition?: { x: number; y: number; index: number } | null;
}

const LINE_HEIGHT = 24;
const FONT = '16px system-ui, -apple-system, sans-serif';

export default function WordLevelContent({ 
  content, 
  onContentChange,
  containerWidth = 440,
  obstacles = [],
  dragPosition = null
}: WordLevelContentProps) {
  const [isClient, setIsClient] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTextWithSegments | null>(null);
  const [positionedWords, setPositionedWords] = useState<PositionedWord[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Only run on client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Prepare text with Pretext
  useEffect(() => {
    if (!content) {
      setPrepared(null);
      return;
    }
    const p = prepareWithSegments(content, FONT);
    setPrepared(p);
  }, [content]);

  // Layout words with Pretext, accounting for obstacles
  useEffect(() => {
    if (!prepared || !containerWidth) {
      setPositionedWords([]);
      return;
    }

    const { lines } = layoutWithLines(prepared, containerWidth, LINE_HEIGHT);
    
    const words: PositionedWord[] = [];
    let wordIndex = 0;
    
    // Get word segment info from prepared text
    const segmentInfo = prepared.segments.filter(s => s.content.trim().length > 0);
    
    lines.forEach((line, lineIndex) => {
      const lineY = lineIndex * LINE_HEIGHT;
      let currentX = line.x;
      
      const lineText = line.text;
      const wordsInLine = lineText.split(/\s+/).filter(w => w.length > 0);
      
      wordsInLine.forEach((wordText) => {
        const segment = segmentInfo[wordIndex];
        const wordWidth = segment ? segment.width : wordText.length * 8;
        
        words.push({
          text: wordText,
          x: currentX,
          y: lineY,
          width: wordWidth,
          lineIndex,
        });
        
        currentX += wordWidth + 6;
        wordIndex++;
      });
    });

    setPositionedWords(words);
  }, [prepared, containerWidth, obstacles]);

  // Native drag handlers
  const handleDragStart = (e: React.DragEvent, wordIndex: number) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", wordIndex.toString());
    e.dataTransfer.effectAllowed = "move";
    setDragIndex(wordIndex);
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDropTargetIndex(targetIndex);
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
    
    if (sourceIndex !== targetIndex && !isNaN(sourceIndex)) {
      // Reorder words in content
      const wordArray = content.split(/\s+/).filter(w => w.length > 0);
      const [movedWord] = wordArray.splice(sourceIndex, 1);
      wordArray.splice(targetIndex, 0, movedWord);
      
      const newContent = wordArray.join(" ");
      if (onContentChange) {
        onContentChange(newContent);
      }
    }

    setDragIndex(null);
    setDropTargetIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropTargetIndex(null);
  };

  if (!isClient || !prepared || positionedWords.length === 0) {
    return <div className="whitespace-pre-wrap">{content}</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ 
        height: Math.ceil(positionedWords.length / 5) * LINE_HEIGHT + 20,
        minHeight: "1.5em"
      }}
    >
      {positionedWords.map((word, i) => (
        <span
          key={i}
          draggable={true}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          className={`
            absolute cursor-move select-none text-stone-200
            px-1 rounded transition-all
            ${dragIndex === i ? "opacity-50" : ""}
            ${dropTargetIndex === i && dragIndex !== i ? "bg-amber-500/40 text-amber-200" : ""}
            hover:bg-stone-700 hover:text-stone-100
          `}
          style={{
            left: word.x,
            top: word.y,
            width: word.width,
            height: LINE_HEIGHT - 2,
            lineHeight: `${LINE_HEIGHT - 2}px`,
          }}
        >
          {word.text}
        </span>
      ))}
      
      {/* Render obstacles for debugging */}
      {obstacles.map((obs, i) => (
        <div
          key={`obs-${i}`}
          className="absolute border border-red-500/30 bg-red-500/10 pointer-events-none"
          style={{
            left: obs.x,
            top: obs.y,
            width: obs.w,
            height: obs.h,
          }}
        />
      ))}
    </div>
  );
}