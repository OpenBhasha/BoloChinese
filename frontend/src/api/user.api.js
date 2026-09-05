import api from "./axios";

export const getMyProfile = () => api.get("/user/me");
export const updateMyProfile = (payload) => api.patch("/user/me", payload);

export const getMyTasks = () => api.get("/user/tasks");
export const getMyProjects = () => api.get("/user/projects");
export const getProjectTasks = (id) => api.get(`/user/projects/${id}/tasks`);
export const getTaskDetail = (id) => api.get(`/user/tasks/${id}`);
export const uploadAudio = (id, file) => {
  const form = new FormData();
  form.append("audio", file);
  return api.post(`/user/tasks/${id}/audio`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

// Stream uploaded audio through the backend proxy
export const streamAudio = (id) => api.get(`/user/tasks/${id}/audio`, { 
  responseType: 'blob' 
});

export const skipTask = (id) => api.post(`/user/tasks/${id}/skip`);
export const flagTaskIssue = (id, payload = {}) => api.post(`/user/tasks/${id}/flag`, payload);
export const verifyPinyin = (id, correct) => api.patch(`/user/tasks/${id}/verify-pinyin`, { correct });
export const correctTranscript = (id, correctedChineseTranscript, correctedPinyin) =>
  api.patch(`/user/tasks/${id}/correct`, { correctedChineseTranscript, correctedPinyin });
export const markErroneous = (id, reason) => api.patch(`/user/tasks/${id}/mark-erroneous`, { reason });
export const discardTask = (id) => api.post(`/user/tasks/${id}/discard`);
export const reconsiderTask = (id) => api.post(`/user/tasks/${id}/reconsider`);
