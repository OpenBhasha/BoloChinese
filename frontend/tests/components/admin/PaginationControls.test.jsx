import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "@tests/helpers/render.jsx";
import PaginationControls from "@/components/admin/PaginationControls.jsx";

const renderPagination = (props) => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  return {
    onPrev,
    onNext,
    ...renderWithProviders(<PaginationControls onPrev={onPrev} onNext={onNext} {...props} />),
  };
};

const previous = () => screen.getByRole("button", { name: "Previous" });
const next = () => screen.getByRole("button", { name: "Next" });

describe("PaginationControls", () => {
  it("shows the current position", () => {
    renderPagination({ currentPage: 2, totalPages: 5 });

    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  });

  it("disables Previous on the first page", () => {
    renderPagination({ currentPage: 1, totalPages: 5 });

    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
  });

  it("disables Next on the last page", () => {
    renderPagination({ currentPage: 5, totalPages: 5 });

    expect(previous()).toBeEnabled();
    expect(next()).toBeDisabled();
  });

  it("disables both when everything fits on one page", () => {
    renderPagination({ currentPage: 1, totalPages: 1 });

    expect(previous()).toBeDisabled();
    expect(next()).toBeDisabled();
  });

  it("moves in both directions from a middle page", async () => {
    const { user, onPrev, onNext } = renderPagination({ currentPage: 3, totalPages: 5 });

    await user.click(previous());
    await user.click(next());

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
