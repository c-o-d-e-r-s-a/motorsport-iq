import Groq from 'groq-sdk';
import type { QuestionInstanceState, RaceSnapshot } from '../types';
import { getQuestionById } from '../engine/questionBank';
import { formatQuestionText } from '../engine/questionEngine';
import { getDriverByNumber } from '../engine/derivedSignals';

const apiKey = process.env.GROQ_API_KEY;
const groq = apiKey ? new Groq({ apiKey }) : null;
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const EXPLANATION_TIMEOUT_MS = 4000;

function hasGroq(): boolean {
  return Boolean(groq);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/** Bank templates are the source of truth — Groq must not rewrite live question copy. */
export async function generateQuestionText(instance: QuestionInstanceState): Promise<string> {
  const question = getQuestionById(instance.questionId);
  if (question && instance.driver1) {
    return formatQuestionText(question, instance.driver1, instance.driver2 ?? null);
  }

  return instance.questionText ?? 'Will this prediction come true?';
}

export async function generateResolutionExplanation(
  instance: QuestionInstanceState,
  currentSnapshot: RaceSnapshot,
  outcome: boolean,
  fallbackExplanation: string
): Promise<string> {
  const question = getQuestionById(instance.questionId);
  const currentDriver1 = instance.driver1
    ? getDriverByNumber(currentSnapshot, instance.driver1.driverNumber)
    : null;
  const currentDriver2 = instance.driver2
    ? getDriverByNumber(currentSnapshot, instance.driver2.driverNumber)
    : null;

  if (!hasGroq() || !question || !instance.driver1) {
    return fallbackExplanation;
  }

  try {
    const response = await withTimeout(
      groq!.chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 160,
        messages: [
          {
            role: 'system',
            content: 'You are an F1 analyst. Explain a resolved yes-or-no race prediction in 2 to 3 concise sentences. Stay factual and grounded in the supplied data.',
          },
          {
            role: 'user',
            content: [
              `Question: ${instance.questionText}`,
              `Outcome: ${outcome ? 'YES' : 'NO'}`,
              `Category: ${question.category}`,
              `Trigger lap: ${instance.triggerSnapshot.lapNumber}`,
              `Resolve lap: ${currentSnapshot.lapNumber}`,
              `Driver A trigger state: P${instance.driver1.position}, interval ${instance.driver1.interval ?? 'N/A'}s, tyre age ${instance.driver1.tyreAge}`,
              `Driver A current state: P${currentDriver1?.position ?? 'N/A'}, interval ${currentDriver1?.interval ?? 'N/A'}s, tyre age ${currentDriver1?.tyreAge ?? 'N/A'}`,
              instance.driver2
                ? `Driver B current state: ${instance.driver2.name}, P${currentDriver2?.position ?? 'N/A'}, interval ${currentDriver2?.interval ?? 'N/A'}s`
                : 'No second driver in this scenario.',
              'Do not mention betting, fantasy, or probabilities.',
            ].join('\n'),
          },
        ],
      }),
      EXPLANATION_TIMEOUT_MS,
      'Groq explanation rewrite'
    );

    return response.choices[0]?.message?.content?.trim() || fallbackExplanation;
  } catch (error) {
    console.error('Failed to generate AI explanation:', error);
    return fallbackExplanation;
  }
}
