// Fallback for inputs whose <label> has no htmlFor, so getByLabelText cannot
// find them. Prefer an accessible query wherever the markup allows one.
export const inputNamed = (name) => {
  const input = document.querySelector(`input[name="${name}"]`);
  if (!input) throw new Error(`No input named "${name}" is rendered.`);
  return input;
};
