import { TEST_TOKEN } from "../config.js";
import { adminUser, annotatorUser } from "../factories/index.js";

// AuthContext reads localStorage in useState initialisers, so seed before rendering.
export const signIn = (user, token = TEST_TOKEN) => {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
  return { user, token };
};

export const signInAsAdmin = (overrides) => signIn(adminUser(overrides));
export const signInAsAnnotator = (overrides) => signIn(annotatorUser(overrides));
