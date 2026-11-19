'use client';

import { Loader as Loader2, Lock } from 'lucide-react';

interface LectureCardProps {
  title: string;
  courseCode?: string;
  instructorName?: string;
  isNew?: boolean;
  status?: string;
  isEducatorLecture?: boolean;
  isPrivateLecture?: boolean;
  onClick: () => void;
}

export default function LectureCard({
  title,
  courseCode,
  instructorName,
  isNew = false,
  status,
  isEducatorLecture = false,
  isPrivateLecture = false,
  onClick
}: LectureCardProps) {
  const getStatusBadge = () => {
    if (status === 'generating') {
      return (
        <span className="px-2 py-1 bg-brand-yellow text-brand-maroon text-xs font-bold rounded-full flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Generating
        </span>
      );
    }
    if (isPrivateLecture) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">
          <Lock className="h-3 w-3" />
          Private
        </span>
      );
    }
    if (isEducatorLecture) {
      return (
        <span className="px-2 py-1 bg-brand-maroon text-white text-xs font-bold rounded-full">
          Educator
        </span>
      );
    }
    if (isNew) {
      return (
        <span className="px-2 py-1 bg-brand-yellow text-brand-maroon text-xs font-bold rounded-full">
          NEW
        </span>
      );
    }
    return null;
  };

  const thumbnailEmojis = ['🧠', '💭', '🗣️', '📚', '✨', '💡'];
  const randomEmoji = thumbnailEmojis[Math.floor(Math.random() * thumbnailEmojis.length)];

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
    >
      <div className="bg-gradient-to-br from-brand-maroon to-brand-maroon-hover h-40 flex items-center justify-center text-6xl group-hover:scale-105 transition-transform">
        {randomEmoji}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-bold text-foreground line-clamp-2 flex-1">{title}</h3>
          {getStatusBadge()}
        </div>
        {(courseCode || instructorName) && (
          <p className="text-sm text-muted-foreground">
            {courseCode && <span>{courseCode}</span>}
            {courseCode && instructorName && <span> • </span>}
            {instructorName && <span>{instructorName}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
