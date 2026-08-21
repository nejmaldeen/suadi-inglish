import type { CoachRequest, CoachScenarioId, LearnerLevel } from "../contracts.ts";

export type CoachScenario = {
  id: CoachScenarioId;
  learnerLevel: LearnerLevel;
  targetSentence: string;
  learningGoal: string;
  specialRules: readonly string[];
};

export const COFFEE_V1_SCENARIO: CoachScenario = {
  id: "coffee-v1",
  learnerLevel: "A2",
  targetSentence: "I’d like to order a flat white, please.",
  learningGoal: "Help an A2 Saudi learner make a polite, clear coffee order in General American English.",
  specialRules: [
    "The scenario is coffee ordering, but do not force every transcript to mean a coffee order.",
    "If the transcript says 'I would like to vote', preserve vote in cleanedTranscript, set needsClarification to true, say the learner may have meant order, and ask them to repeat the word.",
    "The unrelated sentence 'I go to the market yesterday.' must be corrected to 'I went to the market yesterday.' with a short Arabic explanation of went.",
  ],
};

export function getCoachScenario(scenarioId: CoachRequest["scenarioId"]) {
  return scenarioId === COFFEE_V1_SCENARIO.id ? COFFEE_V1_SCENARIO : undefined;
}
