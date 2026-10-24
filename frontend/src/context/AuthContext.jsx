import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

// While an admin is "logged in as" an annotator, their own session is parked
// here ({ token, user, returnTo }) so Exit can swap it back. axios.js reads the
// same key to fall back to it if the impersonation token expires.
const ADMIN_SESSION_KEY = "adminSession";

const readJSON = (key) => {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readJSON("user"));
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [adminSession, setAdminSession] = useState(() => readJSON(ADMIN_SESSION_KEY));

  const applySession = (nextToken, nextUser) => {
    localStorage.setItem("token", nextToken);
    localStorage.setItem("user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const clearAdminSession = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setAdminSession(null);
  };

  const loginUser = (data) => {
    clearAdminSession();
    applySession(data.token, data.user);
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    clearAdminSession();
    setToken(null);
    setUser(null);
  };

  // `data` is the { token, user } an admin gets back from the impersonate endpoint.
  const startImpersonation = (data) => {
    if (adminSession || user?.role !== "admin") return;
    const stash = {
      token: localStorage.getItem("token"),
      user: readJSON("user"),
      returnTo: window.location.pathname,
    };
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(stash));
    setAdminSession(stash);
    applySession(data.token, data.user);
  };

  // Restores the admin's own session; returns the page they started from.
  const stopImpersonation = () => {
    if (!adminSession) return null;
    applySession(adminSession.token, adminSession.user);
    clearAdminSession();
    return adminSession.returnTo || "/admin";
  };

  return (
    <AuthContext.Provider
      value={{
        user, token, loginUser, logout,
        isAdmin: user?.role === "admin",
        isImpersonating: Boolean(adminSession),
        startImpersonation, stopImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
