import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UploadFileRow } from "./UploadFileRow";
import type { UploadViewItem } from "@/types/upload";

afterEach(cleanup);

it("announces successful empty files as 100 percent", () => {
  const item: UploadViewItem = {
    file: new File([], "empty.txt"),
    state: "success",
    error: "",
    speed: 0,
    savedFilename: "empty.txt",
    loadedBytes: 0,
    session: null,
  };
  render(
    createElement(UploadFileRow, {
      item,
      retryDisabled: false,
      onRemove: vi.fn(),
      onRetry: vi.fn(),
    }),
  );
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "100",
  );
  expect(
    screen.getByRole("progressbar").getAttribute("aria-valuetext"),
  ).toContain("上传成功");
});

it("associates errors and retry actions with the file, and blocks retries while the queue is running", () => {
  const item: UploadViewItem = {
    file: new File(["x"], "failed.txt"),
    state: "error",
    error: "网络断开",
    speed: 0,
    savedFilename: "",
    loadedBytes: 0,
    session: null,
  };
  const onRetry = vi.fn();
  const props = { item, retryDisabled: true, onRemove: vi.fn(), onRetry };
  const view = render(createElement(UploadFileRow, props));
  expect(screen.getByRole("alert").textContent).toBe("网络断开");
  fireEvent.click(screen.getByRole("button", { name: "重试 failed.txt" }));
  expect(onRetry).not.toHaveBeenCalled();
  view.rerender(
    createElement(UploadFileRow, { ...props, retryDisabled: false }),
  );
  fireEvent.click(screen.getByRole("button", { name: "重试 failed.txt" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
