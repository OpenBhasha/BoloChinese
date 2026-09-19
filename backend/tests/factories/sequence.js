// Deliberately not random: a failing test replays identically, and the values
// stay readable in assertion output. Uniqueness across parallel workers is not
// a concern because each worker owns its own database.
let current = 0;

export const nextSequence = () => {
  current += 1;
  return current;
};

export const resetSequence = () => {
  current = 0;
};
