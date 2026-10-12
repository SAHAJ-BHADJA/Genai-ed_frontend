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
  User,
  Video,
  Music,
  Presentation,
  Download,
  FileText
} from 'lucide-react';

interface Lecture {
  id: string;
  title: string;
  description: string;
  video_url: string | null;
  video_length: number;
  course_id: string;
  status: string;
  script_text: string | null;
  creator_role: string;
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

interface Artifact {
  id: string;
  artifact_type: 'audio_mp3' | 'audio' | 'pptx' | 'ppt' | 'video_static_mp4' | 'video_avatar_mp4' | 'video_avatar';
  file_url: string;
  created_at: string;
}

export default function StudentLectureViewer() {
  const router = useRouter();
  const params = useParams();
  const courseId = params.courseId as string;
  const lectureId = params.lectureId as string;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'audio' | 'presentation'>('video');
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);

  const [contextSources, setContextSources] = useState({
    syllabus: true,
    courseMaterials: true,
    lectureTranscript: true,
    studentUploads: false
  });

  useEffect(() => {
    loadLectureData();
  }, [lectureId]);

  const loadLectureData = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/student/login');
      return;
    }

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

    const { data: enrollmentCheck } = await supabase
      .from('course_students')
      .select('course_id')
      .eq('email', user.email!)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!enrollmentCheck) {
      router.push('/student/dashboard');
      return;
    }

    const { data: lectureCourseCheck } = await supabase
      .from('lecture_courses')
      .select('lecture_id')
      .eq('course_id', courseId)
      .eq('lecture_id', lectureId)
      .maybeSingle();

    if (!lectureCourseCheck) {
      router.push(`/student/course/${courseId}`);
      return;
    }

    const { data: lectureData } = await supabase
      .from('lectures')
      .select('*')
      .eq('id', lectureId)
      .eq('creator_role', 'educator')
      .maybeSingle();

    if (!lectureData || (lectureData.status !== 'completed' && lectureData.status !== 'published')) {
      router.push(`/student/course/${courseId}`);
      return;
    }

    setLecture(lectureData);

    const { data: courseData } = await supabase
      .from('courses')
      .select('course_number, title, instructor_name')
      .eq('id', courseId)
      .maybeSingle();

    if (courseData) {
      setCourse(courseData);
    }

    const { data: artifactsData } = await supabase
      .from('lecture_artifacts')
      .select('*')
      .eq('lecture_id', lectureId)
      .order('created_at', { ascending: false });

    if (artifactsData) {
      setArtifacts(artifactsData);

      if (artifactsData.some(a => a.artifact_type === 'video_avatar_mp4' || a.artifact_type === 'video_static_mp4' || a.artifact_type === 'video_avatar')) {
        setActiveTab('video');
      } else if (artifactsData.some(a => a.artifact_type === 'audio_mp3' || a.artifact_type === 'audio')) {
        setActiveTab('audio');
      } else if (artifactsData.some(a => a.artifact_type === 'pptx' || a.artifact_type === 'ppt')) {
        setActiveTab('presentation');
      }
    }

    const { data: viewData } = await supabase
      .from('student_lecture_views')
      .select('id')
      .eq('student_id', user.id)
      .eq('lecture_id', lectureId)
      .maybeSingle();

    if (!viewData) {
      await supabase
        .from('student_lecture_views')
        .insert({
          student_id: user.id,
          lecture_id: lectureId,
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
        content: `I understand you're asking about "${userMessage.content}". Based on the lecture content and course materials, here's my response...`
      };
      setMessages(prev => [...prev, assistantMessage]);
      setSending(false);
    }, 1500);
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
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-2xl font-bold text-foreground">{lecture.title}</h1>
              <span className="px-2 py-1 bg-brand-maroon text-white text-xs font-bold rounded-full">
                Educator
              </span>
            </div>
            <p className="text-muted-foreground">
              {course.course_number} • {course.instructor_name}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-0">
            <div className="bg-background border-r border-border overflow-y-auto">
              <div className="p-6 border-b border-border">
                <div className="flex gap-4">
                  {(artifacts.some(a => a.artifact_type === 'video_avatar_mp4' || a.artifact_type === 'video_static_mp4' || a.artifact_type === 'video_avatar')) && (
                    <button
                      onClick={() => setActiveTab('video')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        activeTab === 'video'
                          ? 'bg-brand-maroon text-white'
                          : 'bg-card text-foreground hover:bg-accent'
                      }`}
                    >
                      <Video className="w-4 h-4" />
                      Video
                    </button>
                  )}
                  {artifacts.some(a => a.artifact_type === 'audio_mp3' || a.artifact_type === 'audio') && (
                    <button
                      onClick={() => setActiveTab('audio')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        activeTab === 'audio'
                          ? 'bg-brand-maroon text-white'
                          : 'bg-card text-foreground hover:bg-accent'
                      }`}
                    >
                      <Music className="w-4 h-4" />
                      Audio
                    </button>
                  )}
                  {artifacts.some(a => a.artifact_type === 'pptx' || a.artifact_type === 'ppt') && (
                    <button
                      onClick={() => setActiveTab('presentation')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        activeTab === 'presentation'
                          ? 'bg-brand-maroon text-white'
                          : 'bg-card text-foreground hover:bg-accent'
                      }`}
                    >
                      <Presentation className="w-4 h-4" />
                      Slides
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-6">
                {lecture.status === 'generating' ? (
                  <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 border-4 border-brand-maroon border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-muted-foreground">Generating lecture content...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {activeTab === 'video' && (
                      <>
                        {(() => {
                          const videoArtifact = artifacts.find(a => a.artifact_type === 'video_avatar_mp4' || a.artifact_type === 'video_static_mp4' || a.artifact_type === 'video_avatar');
                          return videoArtifact ? (
                            <div className="aspect-video bg-black rounded-xl overflow-hidden">
                              <video
                                controls
                                className="w-full h-full"
                                src={videoArtifact.file_url}
                              >
                                Your browser does not support the video tag.
                              </video>
                            </div>
                          ) : (
                            <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                              <p className="text-muted-foreground">No video available</p>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {activeTab === 'audio' && (
                      <>
                        {(() => {
                          const audioArtifact = artifacts.find(a => a.artifact_type === 'audio_mp3' || a.artifact_type === 'audio');
                          return audioArtifact ? (
                            <div className="bg-card border border-border rounded-xl p-8">
                              <div className="flex items-center justify-center mb-6">
                                <div className="w-24 h-24 bg-brand-maroon/10 rounded-full flex items-center justify-center">
                                  <Music className="w-12 h-12 text-brand-maroon" />
                                </div>
                              </div>
                              <audio
                                controls
                                className="w-full"
                                src={audioArtifact.file_url}
                              >
                                Your browser does not support the audio tag.
                              </audio>
                              <div className="mt-4 text-center">
                                <a
                                  href={audioArtifact.file_url}
                                  download
                                  className="inline-flex items-center gap-2 text-brand-maroon hover:text-brand-maroon-hover transition-colors"
                                >
                                  <Download className="w-4 h-4" />
                                  Download Audio
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                              <p className="text-muted-foreground">No audio available</p>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    {activeTab === 'presentation' && (
                      <>
                        {(() => {
                          const pptxArtifact = artifacts.find(a => a.artifact_type === 'pptx' || a.artifact_type === 'ppt');
                          return pptxArtifact ? (
                            <div className="bg-card border border-border rounded-xl p-8">
                              <div className="flex items-center justify-center mb-6">
                                <div className="w-24 h-24 bg-brand-maroon/10 rounded-full flex items-center justify-center">
                                  <Presentation className="w-12 h-12 text-brand-maroon" />
                                </div>
                              </div>
                              <div className="text-center space-y-4">
                                <h3 className="text-xl font-bold text-foreground">Presentation Slides</h3>
                                <p className="text-muted-foreground">Download the presentation to view the slides</p>
                                <a
                                  href={pptxArtifact.file_url}
                                  download
                                  className="inline-flex items-center gap-2 bg-brand-maroon hover:bg-brand-maroon-hover text-white px-6 py-3 rounded-lg transition-colors"
                                >
                                  <Download className="w-5 h-5" />
                                  Download Presentation
                                </a>
                              </div>
                            </div>
                          ) : (
                            <div className="aspect-video bg-card border border-border rounded-xl flex items-center justify-center">
                              <p className="text-muted-foreground">No presentation available</p>
                            </div>
                          );
                        })()}
                      </>
                    )}

                    <div className="bg-card border border-border rounded-xl p-6">
                      <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm">{lecture.video_length} min</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="w-4 h-4" />
                          <span className="text-sm">{course.instructor_name}</span>
                        </div>
                      </div>

                      <h3 className="font-bold text-foreground mb-2">About this lecture</h3>
                      <p className="text-muted-foreground">{lecture.description || 'No description available.'}</p>
                    </div>

                    {lecture.script_text && (
                      <div className="bg-card border border-border rounded-xl p-6">
                        <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                          <FileText className="w-5 h-5" />
                          Lecture Script
                        </h3>
                        <div className="prose prose-sm max-w-none text-muted-foreground">
                          <p className="whitespace-pre-wrap">{lecture.script_text}</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
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
                        checked={contextSources.lectureTranscript}
                        onChange={(e) => setContextSources({ ...contextSources, lectureTranscript: e.target.checked })}
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
