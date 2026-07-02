/** Scroll to page top so the HUD + question are visible — only for explicit user actions (e.g. arcade "Answer above"). */
export function scrollQuestionStageIntoView(behavior: ScrollBehavior = 'smooth'): void {
  window.scrollTo({ top: 0, behavior });
}
