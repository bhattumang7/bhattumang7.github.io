---
title: The Architecture of an LLM-Driven Codebase Rewrite: Why "What's Next?" is the Wrong Question
tags: [Large scale rewrite]
style: border
color: light
description: Rewriting a large codebase? You must read this.
---

# The Architecture of an LLM-Driven Codebase Rewrite: Why "What's Next?" is the Wrong Question

Many teams are attempting to rewrite massive, legacy codebases using Large Language Models (LLMs). The reality of this process hits you quickly: you cannot do it in one session. You will need to open multiple, fresh sessions to get through the work. 

If you aren't careful, the intuitive approach—simply asking the LLM, "What should we rewrite next?"—will derail the entire project. Left to manage its own queue, an agent will burn an unreasonable number of tokens just trying to parse what has been done and what is pending. Worse, it will inevitably leave out critical pieces. 

After building several iterations of tracking tools—failing, and then finally succeeding—I’ve learned that a successful AI migration relies entirely on deterministic, external orchestration. Here is the playbook for how to actually structure it.

## The Nuance of Sizing the Work Unit

The immediate hurdle in building a workflow tool is deciding how much work to hand the LLM at once. 

If your tool feeds the agent one method at a time, you hit massive inefficiencies. Token overhead skyrockets because the work unit is too small. Conversely, if you feed it massive, monolithic files, you break the context window. Work chunking requires dynamic sizing, but sizing alone is only the tip of the iceberg. 

The deeper challenge is **dependency orchestration**. 

## The Standard Blueprint for LLM Migrations

You cannot simply feed an LLM random chunks of code; you must respect the call graph. 

Across state-of-the-art tools like AAMF (Autonomous Agent Migration Framework), academic research on database migrations (e.g., Oracle-to-PostgreSQL), and various C-to-Rust translators, a standardised architectural playbook has emerged. It mirrors the manual **Mikado Method**, but automated at scale:

1. **Map the Call Graph:** Build a complete, indexed symbol graph of the legacy codebase to understand how every method and field connects.
2. **Trap the Cycles:** Use algorithms like Tarjan's Strongly Connected Components (SCC) to identify circular dependencies. If methods depend on each other, bind them into the same migration unit so the LLM doesn't generate broken references. 
3. **Merge and Cap:** Greedily merge neighboring clusters based on cohesion (e.g., call links and shared fields). Stop merging only when you hit a maximum line limit to protect the LLM's context window.
4. **Order by Dependency:** Sort the work so that "leaf" functions—those with no prerequisites—are rewritten first, working your way up the tree.
5. **Freeze the Plan:** Save this dependency-sorted task list into a deterministic file (like a `work-queue.json`), ensuring the system always knows exactly what to execute next across fresh sessions.

*(Note: When you hear about large LLM-driven migrations at companies like Airbnb or Google, they are often tackling independent files or isolated test changes. Because those files don't share deep logic dependencies, they bypass the need for this complex orchestration).*

## Context-Window Sizing vs. Session Sizing

Implementations diverge in how they define the size of a "task." 

Most tools chunk work strictly to fit an **agent’s context window**. However, for massive migrations, we've found that bundling work into **session-sized packages** is far more effective. By packing dependencies into larger units meant to be completed in a single, focused session, you drastically lower the token cost and time wasted on repetitive planning phases.

## Advanced Edge Cases to Borrow from AAMF

If you are writing your own implementation to break down and distribute work to agents, I highly recommend looking at [AAMF (jafreck/AAMF)](https://github.com/jafreck/AAMF). Even if you build your own tool, it solves two specific edge cases brilliantly:

1. **Oversized Cycles:** What happens when a circular dependency loop is so large it exceeds your line-count cap? AAMF handles this by generating "stubs" for the cycle first, then dividing the actual implementation into sequential chunks. *(Note: This solves massive groups of interrelated methods, though it still won't save you from a single 2,000-line method).*
2. **Parallel Execution Locks:** If you scale up to run multiple agents simultaneously, you need extra ordering rules in your queue to prevent two tasks from attempting to write to the same target file at the same time.

## The Takeaway

The path to rewriting a codebase with AI isn't about giving the LLM more autonomy; it's about giving it less. Condense the dependency graph, order work dependencies first, pack it into size-capped, session-ready units, and save the plan as a static file. When the agent wakes up in a fresh session, it shouldn't have to think about what to do next—it should just execute the plan.


