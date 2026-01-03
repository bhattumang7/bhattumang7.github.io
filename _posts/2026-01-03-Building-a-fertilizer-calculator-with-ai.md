---
title: Building a Fertilizer Calculator with AI - Sonnet vs Codex
tags: [AI, Gardening, Vue, Programming]
style: border
color: light
description: My experience building a hydroponic fertilizer calculator using Claude Sonnet 4.5 and OpenAI Codex.
---

I recently built a [fertilizer calculator](https://umangbhatt.in/fertilizer-calculator/) for hydroponic gardening using Vue.js. What made this project interesting was using two different AI coding assistants: Claude Sonnet 4.5 and OpenAI Codex.

## Claude Sonnet 4.5

Sonnet has stronger programming knowledge and can guide you through implementation decisions. It understands best practices, catches edge cases, and writes cleaner code. For the bulk of the calculator—Vue components, state management, UI logic—Sonnet was the better choice.

## OpenAI Codex

Codex initially struggled with basics like reading files properly, but has caught up significantly. Where it clearly shines is specialized domain knowledge. EC prediction requires understanding ion dissociation, molar conductivity, and how different salts contribute to conductivity. Codex knew the science; Sonnet did not.

## Key Takeaway

Use the right tool for the job. Sometimes that means combining multiple AI assistants. Sonnet for programming guidance and implementation, Codex for domain-specific scientific knowledge.
