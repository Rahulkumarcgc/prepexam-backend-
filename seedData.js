const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const subjects = [
  {
    name: 'Operating Systems',
    topics: ['Kernel', 'Paging', 'Thrashing', 'Deadlock', 'Mutex', 'Semaphore', 'Virtual Memory', 'Context Switch', 'CPU Scheduling', 'Hardware Interrupts']
  },
  {
    name: 'Database Management',
    topics: ['ACID Properties', 'Normalization', 'B-Trees', 'Indexing', 'Foreign Keys', 'SQL Joins', 'Triggers', 'Materialized Views', 'Transaction Control', 'Concurrency Control']
  },
  {
    name: 'Computer Networks',
    topics: ['OSI Model', 'TCP/IP', 'Routing Tables', 'Subnet Masking', 'DNS Resolution', 'DHCP Leases', 'MAC Addressing', 'Packet Switching', 'Firewall Inspection', 'BGP Protocol']
  },
  {
    name: 'Data Structures & Algorithms',
    topics: ['Dynamic Arrays', 'Doubly Linked Lists', 'LIFO Stacks', 'FIFO Queues', 'Binary Search Trees', 'Directed Graphs', 'Hash Collisions', 'Min-Heaps', 'Trie Structures', 'Divide and Conquer']
  }
];

const templates = [
  { q: "What is the primary function of the {topic}?", a: "To manage operations and state efficiently", b: "To randomly discard legacy data", c: "To intentionally stall the background thread", d: "To bypass internal security completely", ans: "A" },
  { q: "Which of the following best describes {topic}?", a: "A purely physical hardware component unit", b: "A core conceptual mechanism or algorithmic policy", c: "An absolutely obsolete web standard", d: "A type of malicious network virus", ans: "B" },
  { q: "In modern architecture, how is {topic} typically implemented?", a: "Always manually by network administrators", b: "Through mechanical hardware triggers only", c: "Via dedicated algorithms and automated protocols", d: "It is strictly avoided in production environments", ans: "C" }
];

async function seed() {
  const allQs = [];
  
  for (let s of subjects) {
    for (let t of s.topics) {
      for (let temp of templates) {
        allQs.push({
          subject: s.name,
          question_text: temp.q.replace('{topic}', t),
          option_a: temp.a,
          option_b: temp.b,
          option_c: temp.c,
          option_d: temp.d,
          correct_option: temp.ans,
          difficulty: 'MEDIUM'
        });
      }
    }
  }

  console.log(`[SEED SCRIPT] Generating ${allQs.length} advanced B.Tech core questions...`);
  const { error } = await supabase.from('questions').insert(allQs);
  if (error) {
    console.error("[-] Error inserting questions:", error.message);
  } else {
    console.log("[+] SUCCESS! 120 Questions mathematically generated and saved to Supabase.");
    console.log("[+] Check your 'Question Bank Master' page on the Dashboard!");
  }
}

seed();
