import { beforeEach } from "vitest";
import { cloudinaryFake, installCloudinaryFake } from "../fakes/cloudinary.fake.js";

// Installed for every test file, so nothing can reach a real third-party
// account by forgetting to opt in.
installCloudinaryFake();

beforeEach(() => {
  cloudinaryFake().reset();
});
