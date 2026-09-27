# The Suspect Protocol

An AI social-deduction game. Five people are sealed in a research-station lockdown room: you and four autonomous AI crew members. One of the five is the Saboteur. You get three airlock votes to find them.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The game runs fully offline out of the box. To use a real LLM, copy `.env.example` to `.env.local` and add a **Gemini** or **Groq** key, then restart the dev server.

## How a match works

1. **Setup.** A seeded scenario generator builds a mystery that can actually be solved. It hides four layers of clues:
   - **Scene trace:** the tells of two people (the Saboteur's and a decoy's) are found at the scene.
   - **Witness chain:** some innocents can vouch for each other.
   - **Ear-witness:** one innocent noticed the Saboteur's tell in the corridor.
   - **Keycard logs:** the sector in the Saboteur's cover story shows no card activity.
2. **Discussion (rounds 1–3).** Each agent gets two turns per round, and you get the floor between the passes.
   - If you name an agent in a public message, that agent answers next.
   - You can whisper privately to any agent.
   - As an innocent you get 2 keycard scans. As the Saboteur you get 1 forged log.
3. **Vote.** Agents vote programmatically, using their suspicion matrix, the vote they said they'd make, and how much pressure each person is under in the chat. A strict plurality that beats the skip count ejects. Ties keep the airlock sealed.
4. **Win check.**
   - Innocents win if the Saboteur is ejected.
   - The Saboteur wins by surviving round 3 or by reaching parity (1 Saboteur vs 1 innocent).

## Cognitive Telemetry HUD

- **Suspicion radar:** the more the room suspects someone, the closer their blip sits to the center.
- **Room consensus bars**
- **Deception detector:** shows BLUFFING or TRUTHFUL, with a count of lies per agent.
- **Monologue stream:** each agent's internal thought and scratchpad. It stays encrypted until you turn on God Mode, then decrypts on screen.
- **Trust web:** a directed graph of who suspects whom, plus the full suspicion matrix.
- **God Mode:** reveals roles, private memories, false alibis, whispers between agents, forged evidence, and the model source of every line.

## Architecture

| File | Purpose |
|---|---|
| `lib/types.ts` | `GameState`, `AgentProfile`, `ChatMessage`, `AgentActionResponse`, … |
| `lib/scenario-generator.ts` | Seeded incidents, alibis, clue layers, and keycard logs. No API calls, so startup is instant. |
| `lib/game-engine.ts` | Pure reducer state machine, vote logic, win conditions, and the agent request builder |
| `lib/llm.ts` | Gemini (`responseSchema`) or Groq (JSON mode) over `fetch`. Output is validated with Zod and sanitized. A circuit breaker handles 429 and auth errors. |
| `lib/mock-brain.ts` | Deterministic offline brain with a distinct voice per character |
| `app/api/agent/turn/route.ts` | `POST` runs one agent turn. `GET` returns provider status. |
| `components/CognitiveHud.tsx` | The telemetry HUD |
| `app/page.tsx` | The dashboard: turn loop, roster, chat, and abilities |

**Groq model pool.** Groq's free tier allows about 8k tokens per minute *per model*, and it reserves the prompt plus `max_tokens` up front. So each agent's turns are spread across `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` (you can change the fallback models with `GROQ_FALLBACK_MODELS`). The server reads Groq's rate-limit headers and rests a model before it would hit a 429. If every model is resting, a turn waits up to about 12s for one to free up, while the UI shows the agent as "composing…". Only after that does it use the offline brain. In a full live test match, 22 of 24 turns came from the LLM, and after the qwen fix, 8 of 8.

**Fallback chain.** The game tries the LLM first. If that fails, the server runs the offline brain. If the server itself can't be reached, the browser runs the offline brain instead. Every turn is labeled with its source, so you can see what produced it.
