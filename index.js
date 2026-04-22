require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./supabaseClient");

const app = express();
const PORT = process.env.PORT || 5000;

// CORS — allows all origins (handles both local dev and production frontend)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------

// Root route so browser doesn't show "Cannot GET /"
app.get("/", (req, res) => {
  res.send("<h1>🚀 PrepExam Backend Server is Live!</h1><p>API is listening. Go to your frontend at port 5173 to test.</p>");
});

app.get("/health", (req, res) => {
  res.send({ status: "API is running smoothly! 🚀" });
});

// Sync User from Frontend to Supabase
// Since this is a local development project, we can sync the user directly from React
// instead of dealing with complex ngrok webhooks.
app.post("/api/users/sync", async (req, res) => {
  const { clerk_id, email, name } = req.body;

  if (!clerk_id || !email) {
    return res.status(400).json({ error: "Missing required user fields" });
  }

  try {
    // Check if user already exists
    const { data: existingUser, error: searchError } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', clerk_id)
      .single();

    if (searchError && searchError.code !== 'PGRST116') {
      // Ignore 'Row not found' error (PGRST116), throw on other errors
      throw searchError;
    }

    if (existingUser) {
      // User already saved in our DB
      return res.status(200).json({ message: "User already synced", user: existingUser });
    }

    // Insert new user into Supabase
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        { clerk_id, email, name, role: 'STUDENT' }
      ])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // Race condition: another request just inserted the user. Fetch and return it.
        const { data: retryUser } = await supabase.from('users').select('*').eq('clerk_id', clerk_id).single();
        return res.status(200).json({ message: "User already synced", user: retryUser });
      }
      throw insertError;
    }

    console.log(`[SYNC SUCCESS] New user saved: ${name} (${email})`);
    return res.status(201).json({ message: "User created successfully", user: newUser });

  } catch (err) {
    console.error("[SYNC ERROR]:", err.message || err);
    return res.status(500).json({ error: err.message || JSON.stringify(err) });
  }
});

// FETCH ALL USERS (Admin Power & Testing)
app.get("/api/users", async (req, res) => {
  try {
    const { data: users, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH CURRENT USER'S DB PROFILE
app.get("/api/users/me", async (req, res) => {
  const { clerk_id } = req.query;
  if(!clerk_id) return res.status(400).json({ success: false });
  try {
    const { data, error } = await supabase.from('users').select('*').eq('clerk_id', clerk_id).single();
    if (error) throw error;
    res.status(200).json({ success: true, user: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH USER EXAM HISTORY (Results)
app.get("/api/users/me/results", async (req, res) => {
  const { clerk_id } = req.query;
  if(!clerk_id) return res.status(400).json({ success: false });
  try {
    const { data: user, error: uErr } = await supabase.from('users').select('id').eq('clerk_id', clerk_id).single();
    if (uErr) throw uErr;

    const { data, error } = await supabase.from('results')
      .select('*, exams:exam_id (title, total_marks)')
      .eq('student_id', user.id).order('created_at', { ascending: false });
      
    if (error) throw error;
    res.status(200).json({ success: true, results: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for dynamic decoding
const calculateSemester = (roll) => {
  if(!roll) return null;
  const r = roll.toUpperCase();
  if(r.startsWith('NAND')) return '6th Semester';
  if(r.startsWith('DE')) return '5th Semester';
  if(r.startsWith('NEHA')) return '4th Semester';
  if(r.startsWith('RAHA')) return '3rd Semester';
  if(r.startsWith('NAN')) return '2nd Semester';
  if(r.startsWith('FUT')) return '1st Semester';
  return 'Not Assigned';
};

// UPDATE USER ROLL NUMBER
app.put("/api/users/roll", async (req, res) => {
  const { clerk_id, roll_number } = req.body;
  if (!clerk_id || !roll_number) return res.status(400).json({ success: false, error: "Missing data" });

  try {
    const sem = calculateSemester(roll_number);
    const { error } = await supabase.from('users').update({ roll_number, semester: sem }).eq('clerk_id', clerk_id);
    if (error) throw error;
    res.status(200).json({ success: true, semester: sem });
  } catch (err) {
    console.error("[ACTIVATE ROLL ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// UPDATE FULL PROFILE
app.put("/api/users/profile", async (req, res) => {
  const { clerk_id, name, roll_number } = req.body;
  if (!clerk_id) return res.status(400).json({ success: false });

  try {
    const sem = calculateSemester(roll_number);
    const { error } = await supabase.from('users').update({ name, roll_number, semester: sem }).eq('clerk_id', clerk_id);
    if (error) throw error;
    res.status(200).json({ success: true, semester: sem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// UPDATE USER ROLE (Admin Power)
app.put("/api/users/:id/role", async (req, res) => {
  const { role } = req.body;
  
  if (!['ADMIN', 'TEACHER', 'STUDENT'].includes(role)) {
    return res.status(400).json({ success: false, error: "Invalid role specified." });
  }

  try {
    const { error } = await supabase.from('users').update({ role }).eq('id', req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[UPDATE ROLE ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ADMIN ANALYTICS METRICS AGGREGATION
app.get("/api/admin/stats", async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: examsCount } = await supabase.from('exams').select('*', { count: 'exact', head: true });
    const { count: questionsCount } = await supabase.from('questions').select('*', { count: 'exact', head: true });
    const { count: submitsCount } = await supabase.from('results').select('*', { count: 'exact', head: true });

    res.json({ success: true, stats: { 
      users: usersCount || 0,
      exams: examsCount || 0,
      questions: questionsCount || 0,
      submissions: submitsCount || 0
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CREATE EXAM ROUTE (Admin)
app.post("/api/exams", async (req, res) => {
  const { title, duration_minutes, total_marks, marks_per_question, negative_marks, valid_from, valid_until } = req.body;
  try {
    const { data, error } = await supabase
      .from('exams')
      .insert([
        { 
          title, 
          duration_minutes: parseInt(duration_minutes), 
          total_marks: parseInt(total_marks), 
          marks_per_question: parseInt(marks_per_question), 
          negative_marks: parseFloat(negative_marks),
          valid_from: valid_from || null,
          valid_until: valid_until || null,
          status: 'PUBLISHED'
        }
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, exam: data });
  } catch (err) {
    console.error("[EXAM CREATE ERROR]:", err.message || err);
    res.status(500).json({ success: false, error: err.message || JSON.stringify(err) });
  }
});

// FETCH ALL EXAMS (To display in Dashboard)
app.get("/api/exams", async (req, res) => {
  try {
    const { data: exams, error } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, exams });
  } catch (err) {
    console.error("[FETCH EXAMS ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE AN EXAM (Admin only)
app.delete("/api/exams/:id", async (req, res) => {
  try {
    const { error } = await supabase.from('exams').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("[DELETE EXAM ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH A SINGLE EXAM BY ID
app.get("/api/exams/:id", async (req, res) => {
  try {
    const { data: exam, error } = await supabase.from('exams').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.status(200).json({ success: true, exam });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH ALL QUESTIONS FOR AN EXAM (Using the exam_questions junction table)
app.get("/api/exams/:id/questions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('exam_questions')
      .select('question_id, questions(*)')
      .eq('exam_id', req.params.id);

    if (error) throw error;
    
    // Extract simply the questions objects from the join
    const questions = data.map(item => item.questions);
    res.status(200).json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADD A NEW QUESTION TO AN EXAM
app.post("/api/exams/:id/questions", async (req, res) => {
  const { question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;
  
  if (!question_text || !option_a || !correct_option) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    // 1. Save Question to Question Bank
    const { data: newQuestion, error: qError } = await supabase.from('questions').insert([{ 
        subject: 'General', 
        question_text, option_a, option_b, option_c, option_d, correct_option, 
        difficulty: 'MEDIUM' 
    }]).select().single();
    
    if (qError) throw qError;

    // 2. Link Question to the Exam
    const { error: mappingError } = await supabase.from('exam_questions').insert([{ 
        exam_id: req.params.id, 
        question_id: newQuestion.id 
    }]);

    if (mappingError) throw mappingError;

    res.status(201).json({ success: true, question: newQuestion });
  } catch (err) {
    console.error("[ADD QUESTION ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ADD STANDALONE QUESTION DIRECTLY TO GLOBAL BANK
app.post("/api/questions/standalone", async (req, res) => {
  const { subject, question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;
  if (!question_text || !option_a || !correct_option) return res.status(400).json({ success: false });
  try {
    const { data: newQuestion, error } = await supabase.from('questions').insert([{ 
        subject: subject || 'General', 
        question_text, option_a, option_b, option_c, option_d, correct_option, 
        difficulty: 'MEDIUM' 
    }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, question: newQuestion });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SEED BTECH QUESTIONS
app.get("/api/seed/btech", async (req, res) => {
  const btechMCQs = [
    { subject: 'Database Management Systems', question_text: "What does ACID stand for in database transactions?", option_a: "Atomicity, Consistency, Isolation, Durability", option_b: "Authentication, Control, Integrity, Data", option_c: "Accuracy, Consistency, Information, Dependency", option_d: "All of the above", correct_option: "A", difficulty: "HARD" },
    { subject: 'Database Management Systems', question_text: "Which normal form removes transitive dependencies?", option_a: "1NF", option_b: "2NF", option_c: "3NF", option_d: "BCNF", correct_option: "C", difficulty: "MEDIUM" },
    { subject: 'Database Management Systems', question_text: "Who developed the Relational Database Model?", option_a: "Bill Gates", option_b: "E.F. Codd", option_c: "Charles Babbage", option_d: "Alan Turing", correct_option: "B", difficulty: "EASY" },
    { subject: 'Database Management Systems', question_text: "Which SQL clause is used to filter records after aggregation?", option_a: "WHERE", option_b: "GROUP BY", option_c: "HAVING", option_d: "ORDER BY", correct_option: "C", difficulty: "MEDIUM" },
    { subject: 'Operating Systems', question_text: "What is a Deadlock in OS?", option_a: "A situation where a process is waiting indefinitely for a resource", option_b: "A condition where CPU freezes", option_c: "Memory leak", option_d: "Network failure", correct_option: "A", difficulty: "HARD" },
    { subject: 'Operating Systems', question_text: "Which CPU scheduling algorithm gives highest preference to shortest jobs?", option_a: "Round Robin", option_b: "SJF (Shortest Job First)", option_c: "FCFS", option_d: "Priority", correct_option: "B", difficulty: "EASY" },
    { subject: 'Operating Systems', question_text: "What is thrashing?", option_a: "High I/O operation rate", option_b: "Process spends more time paging than executing", option_c: "High CPU utilization", option_d: "Network congestion", correct_option: "B", difficulty: "HARD" },
    { subject: 'Data Structures and Algorithms', question_text: "What is the worst-case time complexity of QuickSort?", option_a: "O(n log n)", option_b: "O(n)", option_c: "O(n^2)", option_d: "O(log n)", correct_option: "C", difficulty: "MEDIUM" },
    { subject: 'Data Structures and Algorithms', question_text: "Which data structure strictly follows the LIFO (Last In First Out) principle?", option_a: "Queue", option_b: "Tree", option_c: "Graph", option_d: "Stack", correct_option: "D", difficulty: "EASY" },
    { subject: 'Data Structures and Algorithms', question_text: "A balanced binary search tree guarantees search time of:", option_a: "O(1)", option_b: "O(n)", option_c: "O(log n)", option_d: "O(n^2)", correct_option: "C", difficulty: "MEDIUM" },
    { subject: 'Computer Networks', question_text: "Which layer of the OSI model handles IP Routing?", option_a: "Data Link Layer", option_b: "Network Layer", option_c: "Transport Layer", option_d: "Application Layer", correct_option: "B", difficulty: "EASY" },
    { subject: 'Computer Networks', question_text: "What is the architectural size of an IPv4 address?", option_a: "16 bits", option_b: "32 bits", option_c: "64 bits", option_d: "128 bits", correct_option: "B", difficulty: "EASY" },
    { subject: 'Computer Networks', question_text: "Which transport protocol prioritizes speed over reliability?", option_a: "TCP", option_b: "FTP", option_c: "UDP", option_d: "SMTP", correct_option: "C", difficulty: "MEDIUM" },
    { subject: 'Software Engineering', question_text: "Which SDLC model is strictly sequential and non-iterative?", option_a: "Agile", option_b: "Spiral", option_c: "Waterfall", option_d: "Scrum", correct_option: "C", difficulty: "EASY" }
  ];
  try {
    const { error } = await supabase.from('questions').insert(btechMCQs);
    if(error) throw error;
    res.status(200).json({ success: true, count: btechMCQs.length });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH ALL GLOBAL QUESTIONS (For the Question Bank Picker)
app.get("/api/questions", async (req, res) => {
  try {
    const { data, error } = await supabase.from('questions').select('*').order('created_at', { ascending: false });
    if(error) throw error;
    res.status(200).json({ success: true, questions: data });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// BULK LINK EXISTING QUESTIONS TO AN EXAM
app.post("/api/exams/:id/link-questions", async (req, res) => {
  const { question_ids } = req.body; 
  if (!question_ids || question_ids.length === 0) return res.status(400).json({ success: false });

  try {
    const records = question_ids.map(qid => ({ exam_id: req.params.id, question_id: qid }));
    // Upserting handles duplicates gracefully (so no error if already mapped)
    const { error } = await supabase.from('exam_questions').upsert(records, { onConflict: 'exam_id,question_id' });
    if(error) throw error;
    res.status(200).json({ success: true });
  } catch(err) {
    console.error("[LINK QUES ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// FETCH LEADERBOARD FOR AN EXAM
app.get("/api/exams/:id/leaderboard", async (req, res) => {
  try {
    const { data: results, error } = await supabase
      .from('results')
      .select('id, total_score, status, time_taken_minutes, created_at, users(name, email)')
      .eq('exam_id', req.params.id)
      .order('total_score', { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, leaderboard: results });
  } catch (err) {
    console.error("[LEADERBOARD ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE A QUESTION
app.delete("/api/questions/:id", async (req, res) => {
  try {
    const { error } = await supabase.from('questions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ATTEMPT EXAM SUBMISSION & AUTO-GRADING
app.post("/api/exams/:id/submit", async (req, res) => {
  const { clerk_id, answers } = req.body; 
  // answers object format: { 'q_uuid_1': 'A', 'q_uuid_2': 'C' }
  const examId = req.params.id;

  try {
    // 1. Get exact Database ID of the Student
    const { data: user, error: userError } = await supabase.from('users').select('id').eq('clerk_id', clerk_id).single();
    if (userError) throw new Error("Student record not found in Database");

    // 2. Load the Exam configurations (Marks, Negative marks)
    const { data: exam, error: examError } = await supabase.from('exams').select('*').eq('id', examId).single();
    if (examError) throw new Error("Exam configuration not found");

    // 3. Load the Correct Answers from Question Bank
    const { data: examQs, error: eqError } = await supabase
      .from('exam_questions')
      .select('question_id, questions(correct_option)')
      .eq('exam_id', examId);
    if (eqError) throw eqError;

    // 4. Grading Engine Logic
    let totalScore = 0;

    examQs.forEach(eq => {
      const qId = eq.question_id;
      const actualCorrect = eq.questions.correct_option;
      const studentAnswer = answers[qId];

      if (studentAnswer) {
         if (studentAnswer === actualCorrect) {
            totalScore += exam.marks_per_question;
         } else {
            totalScore -= exam.negative_marks; // Deduct negative marking
         }
      }
    });

    const status = (totalScore >= (exam.total_marks * 0.40)) ? 'PASS' : 'FAIL'; // 40% Passing Criteria

    // 5. Wipe any previous attempts to bypass Unique Constraint limits during testing
    await supabase.from('results').delete().match({ exam_id: examId, student_id: user.id });

    // 6. Store the crisp new Result
    const { data: result, error: resultError } = await supabase.from('results').insert([{
       exam_id: examId,
       student_id: user.id,
       total_score: totalScore,
       status: status,
       time_taken_minutes: exam.duration_minutes // Default max proxy
    }]).select().single();

    if (resultError) throw resultError;

    res.status(200).json({ success: true, result });
  } catch (err) {
    console.error("[SUBMIT EXAM ERROR]:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// SERVER LAUNCH
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Backend server listening on http://localhost:${PORT}`);
});
