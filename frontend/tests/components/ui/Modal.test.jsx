import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "@tests/helpers/render.jsx";
import Modal from "@/components/ui/Modal.jsx";

const renderModal = (props = {}) => {
  const onClose = vi.fn();
  const result = renderWithProviders(
    <Modal title="Submit recording?" onClose={onClose} {...props}>
      <p>Are you sure?</p>
    </Modal>
  );
  // The backdrop is the modal's root element and has no accessible role.
  return { onClose, backdrop: result.container.firstChild, ...result };
};

describe("Modal", () => {
  it("shows its title and content", () => {
    renderModal();

    expect(screen.getByRole("heading", { name: "Submit recording?" })).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  describe("when dismissible", () => {
    it("closes on Escape", async () => {
      const { user, onClose } = renderModal();

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes on a backdrop click", async () => {
      const { user, onClose, backdrop } = renderModal();

      await user.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes from its close button", async () => {
      const { user, onClose } = renderModal();

      await user.click(screen.getByRole("button"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("stays open when clicking inside the dialog", async () => {
      const { user, onClose } = renderModal();

      await user.click(screen.getByText("Are you sure?"));

      expect(onClose).not.toHaveBeenCalled();
    });

    it("stops listening for Escape once unmounted", async () => {
      const { user, onClose, unmount } = renderModal();

      unmount();
      await user.keyboard("{Escape}");

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("when not dismissible", () => {
    it("offers no close button", () => {
      renderModal({ dismissible: false });

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("ignores Escape and backdrop clicks, so the user must choose", async () => {
      const { user, onClose, backdrop } = renderModal({ dismissible: false });

      await user.keyboard("{Escape}");
      await user.click(backdrop);

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
