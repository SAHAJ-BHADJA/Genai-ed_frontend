import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateQuizHTML(quiz: any, batchData: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Quiz - ${quiz.student_name || 'Student'}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #7C0000; }
    .question { margin: 30px 0; }
    .question-number { font-weight: bold; }
    .options { list-style-type: none; padding: 0; }
    .options li { margin: 10px 0; }
    .header { border-bottom: 2px solid #7C0000; padding-bottom: 10px; margin-bottom: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Quiz</h1>
    <p><strong>Student:</strong> ${quiz.student_name || 'Student'}</p>
    <p><strong>Material:</strong> ${quiz.student_file_name}</p>
    <p><strong>Questions:</strong> ${quiz.mcq_count} Multiple Choice</p>
  </div>

  ${quiz.quiz_content_json.questions.map((q: any) => `
    <div class="question">
      <p class="question-number">Question ${q.number}:</p>
      <p>${q.question}</p>
      <ul class="options">
        <li>A) ${q.options[0]}</li>
        <li>B) ${q.options[1]}</li>
        <li>C) ${q.options[2]}</li>
        <li>D) ${q.options[3]}</li>
      </ul>
    </div>
  `).join('')}
</body>
</html>
  `.trim();
}

function generateAnswerHTML(quiz: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Answer Key - ${quiz.student_name || 'Student'}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #7C0000; }
    .answer { margin: 20px 0; padding: 15px; background: #f5f5f5; border-left: 3px solid #7C0000; }
    .answer-number { font-weight: bold; color: #7C0000; }
    .header { border-bottom: 2px solid #7C0000; padding-bottom: 10px; margin-bottom: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Answer Key</h1>
    <p><strong>Student:</strong> ${quiz.student_name || 'Student'}</p>
    <p><strong>Material:</strong> ${quiz.student_file_name}</p>
  </div>

  ${quiz.answers_content_json.answers.map((a: any) => `
    <div class="answer">
      <p class="answer-number">Question ${a.number}:</p>
      <p><strong>Correct Answer:</strong> ${a.correct_answer}</p>
      <p>${a.explanation}</p>
    </div>
  `).join('')}
</body>
</html>
  `.trim();
}

function createSimpleZip(files: { name: string; content: string }[]): Buffer {
  const encoder = new TextEncoder();
  const chunks: Buffer[] = [];

  for (const file of files) {
    const content = encoder.encode(file.content);
    const filename = file.name;

    const header = Buffer.alloc(30 + filename.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(filename.length, 26);
    header.writeUInt16LE(0, 28);
    header.write(filename, 30);

    chunks.push(header);
    chunks.push(Buffer.from(content));
  }

  const centralDirOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const centralDirChunks: Buffer[] = [];

  let offset = 0;
  for (const file of files) {
    const content = encoder.encode(file.content);
    const filename = file.name;

    const cdHeader = Buffer.alloc(46 + filename.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(0, 16);
    cdHeader.writeUInt32LE(content.length, 20);
    cdHeader.writeUInt32LE(content.length, 24);
    cdHeader.writeUInt16LE(filename.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(offset, 42);
    cdHeader.write(filename, 46);

    centralDirChunks.push(cdHeader);
    offset += 30 + filename.length + content.length;
  }

  const centralDirSize = centralDirChunks.reduce((sum, chunk) => sum + chunk.length, 0);

  const endOfCentralDir = Buffer.alloc(22);
  endOfCentralDir.writeUInt32LE(0x06054b50, 0);
  endOfCentralDir.writeUInt16LE(0, 4);
  endOfCentralDir.writeUInt16LE(0, 6);
  endOfCentralDir.writeUInt16LE(files.length, 8);
  endOfCentralDir.writeUInt16LE(files.length, 10);
  endOfCentralDir.writeUInt32LE(centralDirSize, 12);
  endOfCentralDir.writeUInt32LE(centralDirOffset, 16);
  endOfCentralDir.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...centralDirChunks, endOfCentralDir]);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const quizBatchId = searchParams.get('quizBatchId');
    const type = searchParams.get('type');

    if (!quizBatchId || !type) {
      return NextResponse.json(
        { error: 'Quiz batch ID and type are required' },
        { status: 400 }
      );
    }

    const { data: batchData } = await supabase
      .from('quiz_batches')
      .select('*')
      .eq('id', quizBatchId)
      .single();

    const { data: generatedQuizzes } = await supabase
      .from('quiz_generated')
      .select('*')
      .eq('quiz_batch_id', quizBatchId);

    if (!generatedQuizzes || generatedQuizzes.length === 0) {
      return NextResponse.json(
        { error: 'No generated quizzes found' },
        { status: 404 }
      );
    }

    const enrichedQuizzes = await Promise.all(
      generatedQuizzes.map(async (quiz) => {
        if (quiz.student_id) {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', quiz.student_id)
            .maybeSingle();

          return {
            ...quiz,
            student_name: profileData
              ? `${profileData.first_name} ${profileData.last_name}`
              : 'Student',
          };
        }
        return { ...quiz, student_name: 'Course Material' };
      })
    );

    const files: { name: string; content: string }[] = [];

    for (const quiz of enrichedQuizzes) {
      const studentName = quiz.student_name.replace(/[^a-zA-Z0-9]/g, '_');

      if (type === 'all_zip' || type === 'quizzes_zip') {
        files.push({
          name: `quiz_${studentName}.html`,
          content: generateQuizHTML(quiz, batchData),
        });
      }

      if (type === 'all_zip' || type === 'answers_zip') {
        files.push({
          name: `answers_${studentName}.html`,
          content: generateAnswerHTML(quiz),
        });
      }
    }

    const zipBuffer = createSimpleZip(files);

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="quiz-${type}-${Date.now()}.zip"`,
      },
    });
  } catch (error) {
    console.error('Error downloading quizzes:', error);
    return NextResponse.json(
      { error: 'Failed to download quizzes' },
      { status: 500 }
    );
  }
}
