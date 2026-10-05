// Not random, so a failing test replays identically.
let current = 0;

export const nextSequence = () => (current += 1);
