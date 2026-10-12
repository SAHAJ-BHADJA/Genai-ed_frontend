'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import StudentLayout from '@/components/StudentLayout';
import { supabase, Profile } from '@/lib/supabase';
import { hasProfileRole } from '@/lib/profileRoles';
import {
  ArrowLeft,
  MessageSquare,
  Send,
  CheckSquare,
  Clock,
  User
} from 'lucide-react';

interface StudentLecture {
  id: string;
  title: string;
  prompt: string;
  video_url: string | null;
  video_length: number;
  course_id: string;
  status: string;
  transcript: string | null;
  created_at: string;
}

interface Course {
  course_number: string;
  title: string;
  instructor_name: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export default function StudentMyLectureViewer() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;
  const lectureId = params.lectureId as string;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lecture, setLecture] = useState<StudentLecture | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);

  const [contextSources, setContextSources] = useState({
    syllabus: true,
    courseMaterials: true,
    generatedTranscript: true,
    studentUploads: true
  });

  useEffect(() => {
    loadLectureData();
    const interval = setInterval(() => {
      if (lecture?.status === 'generating') {
        loadLectureData();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [lectureId]);

  const loadLectureData = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/student/login');
      return;
    }

    if (!profile) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileData || !hasProfileRole(profileData, 'student')) {
        router.push('/');
        return;
      }

      setProfile(profileData);
    }

    const { data: lectureData } = await supabase
      .from('student_lectures')
      .select('*')
      .eq('id', lectureId)
      .eq('student_id', user.id)
      .maybeSingle();

    if (!lectureData) {
      router.push('/student/dashboard');
      return;
    }

    setLecture(lectureData);

    const { data: courseData } = await supabase
      .from('courses')
      .select('course_number, title, instructor_name')
      .eq('id', lectureData.course_id)
      .maybeSingle();

    if (courseData) {
      setCourse(courseData);
    }

    const { data: viewData } = await supabase
      .from('student_lecture_views')
      .select('id')
      .eq('student_id', user.id)
      .eq('student_lecture_id', lectureId)
      .maybeSingle();

    if (!viewData) {
      await supabase
        .from('student_lecture_views')
        .insert({
          student_id: user.id,
          student_lecture_id: lectureId,
          duration_watched: 0,
          completed: false
        });
    }

    setLoading(false);
  };

  const handleSendMessage = async () => {
    if (!prompt.trim() || sending) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt
    };

    setMessages([...messages, userMessage]);
    setPrompt('');
    setSending(true);

    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Based on your generated lecture and the context you've provided, here's my response to "${userMessage.content}"...`
      };
      setMessages(prev => [...prev, assistantMessage]);
      setSending(false);
    }, 1500);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} min ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;

    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading lecture...</p>
        </div>
      </div>
    );
  }

  if (!lecture || !course) {
    return (
      <StudentLayout profile={profile}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-gray-600">Lecture not found</p>
          </div>
        </div>
      </StudentLayout>
    );
  }

  return (
    <StudentLayout profile={profile}>
      <div className="h-full flex flex-col">
        <div className="bg-card border-b border-border px-6 py-4">
          <button
            onClick={() => router.push(`/student/course/${courseId}`)}
            className="flex items-center gap-2 text-brand-maroon hover:text-brand-maroon-hover transition-colors mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Course
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground mb-1">{lecture.title}</h1>
              <p className="text-muted-foreground">
                {course.course_number} • Generated by you • {formatTimeAgo(lecture.created_at)}
              </p>
            </div>
            {lecture.status === 'generating' && (
              <span className="px-3 py-1 bg-brand-yellow text-brand-maroon text-sm font-medium rounded-full">
                Generating...
              </span>
            )}
            {lecture.status === 'completed' && (
              <span className="px-3 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-sm font-medium rounded-full">
                Ready
              </span>
            )}
            {lecture.status === 'failed' && (
              <span className="px-3 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-sm font-medium rounded-full">
                Failed
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-0">
            <div className="bg-background border-r border-border p-6 overflow-y-auto">
              <div className="max-w-3xl mx-auto space-y-6">
                {lecture.status === 'generating' ? (
                  <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-foreground font-medium mb-2">Generating your lecture video...</p>
                      <p className="text-sm text-muted-foreground">This may take a few minutes</p>
                    </div>
                  </div>
                ) : lecture.status === 'failed' ? (
                  <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-red-600 dark:text-red-400 font-medium mb-2">Generation failed</p>
                      <p className="text-sm text-muted-foreground">Please try again or contact support</p>
                    </div>
                  </div>
                ) : lecture.video_url ? (
                  <div className="aspect-video bg-black rounded-xl overflow-hidden">
                    <video
                      controls
                      className="w-full h-full"
                      src={lecture.video_url}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                ) : (
                  <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                    <p className="text-muted-foreground">Video will appear here when ready</p>
                  </div>
                )}

                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span className="text-sm">{lecture.video_length} min</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="w-4 h-4" />
                      <span className="text-sm">You</span>
                    </div>
                  </div>

                  <h3 className="font-bold text-foreground mb-2">Your prompt</h3>
                  <p className="text-muted-foreground">{lecture.prompt}</p>

                  {lecture.transcript && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <h3 className="font-bold text-foreground mb-2">Transcript</h3>
                      <div className="text-sm text-muted-foreground max-h-60 overflow-y-auto">
                        {lecture.transcript}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-card flex flex-col h-full">
              <div className="p-6 border-b border-border">
                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Chat with AI
                </h2>

                <div className="space-y-3 mb-4">
                  <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <CheckSquare className="w-4 h-4" />
                    Context Sources
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={contextSources.syllabus}
                        onChange={(e) => setContextSources({ ...contextSources, syllabus: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                      />
                      <span className="text-foreground">Syllabus</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={contextSources.courseMaterials}
                        onChange={(e) => setContextSources({ ...contextSources, courseMaterials: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                      />
                      <span className="text-foreground">Materials</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={contextSources.generatedTranscript}
                        onChange={(e) => setContextSources({ ...contextSources, generatedTranscript: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                      />
                      <span className="text-foreground">Transcript</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={contextSources.studentUploads}
                        onChange={(e) => setContextSources({ ...contextSources, studentUploads: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-brand-maroon focus:ring-brand-maroon"
                      />
                      <span className="text-foreground">My Uploads</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-12">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Ask questions about this lecture</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-xl px-4 py-3 ${
                          message.role === 'user'
                            ? 'bg-brand-maroon text-white'
                            : 'bg-accent text-foreground'
                        }`}
                      >
                        <p className="text-sm">{message.content}</p>
                      </div>
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-accent rounded-xl px-4 py-3">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-border">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask a question about this lecture..."
                    className="flex-1 px-4 py-3 border border-border rounded-lg focus:ring-2 focus:ring-brand-maroon focus:border-transparent bg-background text-foreground"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!prompt.trim() || sending}
                    className="bg-brand-maroon hover:bg-brand-maroon-hover text-white p-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StudentLayout>
  );
}
