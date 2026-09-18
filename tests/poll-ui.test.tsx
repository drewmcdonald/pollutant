// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PollEditor } from "../components/polls/poll-editor";
import { AudienceClient } from "../app/e/[publicSlug]/audience-client";
import { getFunctionName } from "convex/server";
import { ControlRoomClient } from "../lib/control-room-client";
import { DashboardClient } from "../lib/dashboard-client";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: (...args: unknown[]) => mocks.query(...args),
}));
vi.mock("../lib/image-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/image-upload")>()),
  uploadFileWithProgress: mocks.upload,
}));
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
vi.mock("@convex-dev/presence/react", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});

describe("poll setup", () => {
  test("starts with question and options, and submits them together", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<PollEditor busy={false} onSave={save} />);
    await user.type(screen.getByLabelText("Your question"), "Lunch?");
    await user.type(screen.getByLabelText("Option 1"), "Pizza");
    await user.type(screen.getByLabelText("Option 2"), "Tacos");
    expect(screen.queryByLabelText("At least")).toBeNull();
    expect(
      screen.getByText("Options").parentElement?.hasAttribute("open"),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(save).toHaveBeenCalledWith(
      {
        prompt: "Lunch?",
        choices: [{ label: "Pizza" }, { label: "Tacos" }],
        minSelections: 1,
        maxSelections: 1,
      },
      true,
    );
  });

  test("enabling multiple answers on an existing single-answer poll gives a useful limit", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <PollEditor
        busy={false}
        initial={{
          prompt: "Lunch?",
          choices: [{ label: "Pizza" }, { label: "Tacos" }],
          minSelections: 1,
          maxSelections: 1,
        }}
        onSave={save}
      />,
    );
    await user.click(screen.getByText("Options"));
    await user.click(screen.getByLabelText("Allow multiple answers"));
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ minSelections: 1, maxSelections: 2 }),
      true,
    );
  });

  test("Save draft keeps incomplete polls private", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<PollEditor busy={false} onSave={save} />);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "" }),
      false,
    );
  });

  test("pasting options doesn't leave an extra blank answer", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    render(<PollEditor busy={false} onSave={save} />);
    await user.type(screen.getByLabelText("Your question"), "Lunch?");
    await user.click(screen.getByLabelText("Option 1"));
    await user.paste("Pizza\nTacos\nSalad");
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [{ label: "Pizza" }, { label: "Tacos" }, { label: "Salad" }],
      }),
      true,
    );
  });

  test("homepage creation routes to the private host view", async () => {
    const user = userEvent.setup();
    mocks.mutation.mockResolvedValue({
      publicSlug: "test-poll",
      title: "Lunch?",
      questionId: "question-1",
    });
    render(<DashboardClient />);
    await user.type(screen.getByLabelText("Your question"), "Lunch?");
    await user.type(screen.getByLabelText("Option 1"), "Pizza");
    await user.type(screen.getByLabelText("Option 2"), "Tacos");
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Lunch?", start: true }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/host\/test-poll\/.+/),
    );
  });
});

const draftQuestion = {
  _id: "question-1",
  _creationTime: 0,
  eventId: "event-1",
  position: 0,
  prompt: "First question",
  imageUrl: null,
  minSelections: 1,
  maxSelections: 1,
  responseGeneration: 0,
};
function mockDraftWorkspace() {
  mocks.query.mockImplementation((reference) => {
    switch (getFunctionName(reference)) {
      case "presentation:getDeck":
        return {
          event: {
            _id: "event-1",
            title: "First question",
            publicSlug: "test-poll",
            generation: 0,
            currentSlide: { kind: "welcome" },
          },
          questions: [draftQuestion],
          currentQuestionResults: null,
        };
      case "questions:getHostDetail":
        return {
          question: draftQuestion,
          choices: [
            { _id: "choice-1", label: "One", archived: false, imageUrl: null },
            { _id: "choice-2", label: "Two", archived: false, imageUrl: null },
          ],
        };
      case "presentation:getQuestionResults":
        return { questionId: "question-1", ballotCount: 0, choices: [] };
    }
  });
}

describe("adding questions while drafting", () => {
  test("homepage saves the first draft and opens the next editor without starting voting", async () => {
    const user = userEvent.setup();
    mocks.mutation.mockResolvedValue({
      publicSlug: "test-poll",
      title: "First question",
      questionId: "question-1",
    });
    render(<DashboardClient />);
    expect(
      screen.getByRole("button", { name: "Add another question" }),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("Your question"), "First question");
    await user.type(screen.getByLabelText("Option 1"), "One");
    await user.click(
      screen.getByRole("button", { name: "Add another question" }),
    );
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "First question",
        choices: [{ label: "One" }, { label: "" }],
        start: false,
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/host\/test-poll\/.+\?newQuestion=1$/),
    );
  });

  test("host saves unsaved edits before opening a blank next question, repeatedly", async () => {
    const user = userEvent.setup();
    mockDraftWorkspace();
    mocks.mutation
      .mockResolvedValueOnce({ questionId: "question-1" })
      .mockResolvedValueOnce({ questionId: "question-2" });
    render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    await user.type(screen.getByLabelText("Your question"), " edited");
    await user.click(
      screen.getByRole("button", { name: "Add another question" }),
    );
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        questionId: "question-1",
        prompt: "First question edited",
        expectedChoiceIds: ["choice-1", "choice-2"],
        start: false,
      }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("");
    await user.type(screen.getByLabelText("Your question"), "Second question");
    await user.click(
      screen.getByRole("button", { name: "Add another question" }),
    );
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        questionId: undefined,
        prompt: "Second question",
        expectedChoiceIds: [],
        start: false,
      }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  test("failed saves leave the current draft in place", async () => {
    const user = userEvent.setup();
    mockDraftWorkspace();
    mocks.mutation.mockRejectedValue(new Error("Offline"));
    render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    await user.type(screen.getByLabelText("Your question"), " edited");
    await user.click(
      screen.getByRole("button", { name: "Add another question" }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("First question edited");
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't reach the server",
    );
  });

  test("arrival from the homepage opens a fresh editor and clears the one-time URL flag", () => {
    mockDraftWorkspace();
    render(
      <ControlRoomClient
        publicSlug="test-poll"
        hostSecret="host-secret"
        startWithNewQuestion
      />,
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(mocks.replace).toHaveBeenCalledWith("/host/test-poll/host-secret", {
      scroll: false,
    });
  });
});

const audienceState = {
  kind: "question",
  presenceRoomId: "event-1:0",
  question: {
    questionId: "question-1",
    eventGeneration: 0,
    responseGeneration: 0,
    prompt: "Lunch?",
    imageUrl: null,
    minSelections: 1,
    maxSelections: 1,
    votingState: "open",
    votingOpenedAt: 12345,
    ballotCount: 0,
    choices: [
      {
        choiceId: "choice-1",
        label: "Pizza",
        imageUrl: null,
        selections: 0,
        respondentPercentage: 0,
        winner: false,
      },
      {
        choiceId: "choice-2",
        label: "Tacos",
        imageUrl: null,
        selections: 0,
        respondentPercentage: 0,
        winner: false,
      },
    ],
  },
};

describe("audience voting", () => {
  test("single-choice voters can change their selection before submitting", async () => {
    const user = userEvent.setup();
    mocks.query.mockReturnValue(audienceState);
    mocks.mutation.mockResolvedValue({ ballotId: "ballot-1" });
    render(<AudienceClient publicSlug="test-poll" />);
    fireEvent.click(screen.getByLabelText("Pizza"));
    expect((screen.getByLabelText("Tacos") as HTMLInputElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByLabelText("Tacos"));
    await user.click(screen.getByRole("button", { name: "Vote" }));
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({ selectedChoiceIds: ["choice-2"] }),
    );
    expect(screen.getByText("Your vote is in")).toBeTruthy();
  });

  test("closed polls show final results without a vote form", () => {
    mocks.query.mockReturnValue({
      ...audienceState,
      question: {
        ...audienceState.question,
        votingState: "closed",
        ballotCount: 1,
      },
    });
    render(<AudienceClient publicSlug="closed-poll" />);
    expect(screen.getByText("Voting has ended")).toBeTruthy();
    expect(screen.getByText("Here are the final results.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vote" })).toBeNull();
  });
});

describe("inline option images", () => {
  test("image pickers are visible before each input, including newly added options", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<PollEditor busy={false} onSave={save} />);
    const imageButton = screen.getByRole("button", {
      name: "Upload image for option 1",
    });
    expect(imageButton.closest("details")).toBeNull();
    expect(
      imageButton.compareDocumentPosition(screen.getByLabelText("Option 1")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add option" }));
    expect(
      screen.getByRole("button", { name: "Upload image for option 3" }),
    ).toBeTruthy();
    const file = new File(["image"], "option.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image for option 3"), file);
    expect(
      screen
        .getByRole("button", { name: "Replace image for option 3" })
        .querySelector("img")?.src,
    ).toBe("blob:preview");
    await user.click(screen.getByText("Options"));
    await user.click(screen.getByText("Reorder options"));
    await user.click(screen.getByRole("button", { name: "Move option 3 up" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        choices: [{ label: "" }, { label: "", imageFile: file }, { label: "" }],
      }),
      false,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove image for option 2" }),
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        choices: [{ label: "" }, { label: "", imageFile: null }, { label: "" }],
      }),
      false,
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  test("oversized images are rejected without replacing the current preview", async () => {
    const user = userEvent.setup();
    render(<PollEditor busy={false} onSave={vi.fn()} />);
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText("Choose image for option 1"), file);
    expect(screen.getByRole("alert").textContent).toMatch(/5 MiB/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test("homepage uploads images before atomically saving and starting the question", async () => {
    const user = userEvent.setup();
    mocks.mutation
      .mockResolvedValueOnce({ publicSlug: "image-poll", title: "Pictures?" })
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example" })
      .mockResolvedValueOnce({ questionId: "question-1" });
    mocks.upload.mockResolvedValue({ storageId: "image-1" });
    render(<DashboardClient />);
    await user.type(screen.getByLabelText("Your question"), "Pictures?");
    await user.type(screen.getByLabelText("Option 2"), "None");
    const file = new File(["image"], "option.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image for option 1"), file);
    expect(mocks.mutation).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start poll" }));
    expect(mocks.upload).toHaveBeenCalledWith(
      "https://upload.example",
      file,
      expect.any(Function),
    );
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        publicSlug: "image-poll",
        prompt: "Pictures?",
        start: true,
        choices: [{ label: "", imageId: "image-1" }, { label: "None" }],
        expectedChoiceIds: [],
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/host\/image-poll\//),
    );
  });

  test("failed uploads retain the draft and retry uses the same event", async () => {
    const user = userEvent.setup();
    mocks.mutation
      .mockResolvedValueOnce({ publicSlug: "image-poll", title: "Pictures?" })
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example" })
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example/retry" })
      .mockResolvedValueOnce({ questionId: "question-1" });
    mocks.upload
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ storageId: "image-1" });
    render(<DashboardClient />);
    await user.type(screen.getByLabelText("Your question"), "Pictures?");
    const file = new File(["image"], "option.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image for option 1"), file);
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("Pictures?");
    expect(
      screen.getByRole("button", { name: "Replace image for option 1" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(mocks.mutation).toHaveBeenCalledTimes(4);
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ publicSlug: "image-poll" }),
    );
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        publicSlug: "image-poll",
        start: false,
        choices: [{ label: "", imageId: "image-1" }, { label: "" }],
      }),
    );
    expect(mocks.push).toHaveBeenCalledOnce();
  });
});

function mockTwoQuestionWorkspace() {
  const questions = [
    draftQuestion,
    {
      ...draftQuestion,
      _id: "question-2",
      prompt: "Second question",
      position: 1,
    },
  ];
  mocks.query.mockImplementation((reference, args) => {
    switch (getFunctionName(reference)) {
      case "presentation:getDeck":
        return {
          event: {
            _id: "event-1",
            title: "Two questions",
            publicSlug: "test-poll",
            generation: 0,
            currentSlide: { kind: "welcome" },
          },
          questions,
          currentQuestionResults: null,
        };
      case "questions:getHostDetail":
        return {
          question: questions.find((q) => q._id === args.questionId),
          choices: [
            {
              _id: `${args.questionId}-choice-1`,
              label: "One",
              imageUrl: null,
            },
            {
              _id: `${args.questionId}-choice-2`,
              label: "Two",
              imageUrl: null,
            },
          ],
        };
      case "presentation:getQuestionResults":
        return { questionId: args.questionId, ballotCount: 0, choices: [] };
    }
  });
  return questions;
}

describe("question tabs while editing", () => {
  test.each([false, true])(
    "keeps the current form mounted until the next question loads (new draft: %s)",
    async (startWithNewQuestion) => {
      const user = userEvent.setup();
      mockTwoQuestionWorkspace();
      const query = mocks.query.getMockImplementation()!;
      let nextQuestionReady = false;
      mocks.query.mockImplementation((reference, args) => {
        if (
          getFunctionName(reference) === "questions:getHostDetail" &&
          args.questionId === "question-2" &&
          !nextQuestionReady
        )
          return undefined;
        return query(reference, args);
      });
      mocks.mutation.mockResolvedValue({
        questionId: startWithNewQuestion ? "question-3" : "question-1",
      });
      const workspace = (
        <ControlRoomClient
          publicSlug="test-poll"
          hostSecret="host-secret"
          startWithNewQuestion={startWithNewQuestion}
        />
      );
      const { rerender } = render(workspace);
      const questionInput = screen.getByLabelText("Your question");
      await user.type(questionInput, " edited");
      await user.click(screen.getByText("Options"));
      await user.click(screen.getByRole("tab", { name: "2 Second question" }));
      expect(screen.getByLabelText("Your question")).toBe(questionInput);
      expect(questionInput.matches(":disabled")).toBe(true);
      expect(
        screen.getByText("Options").parentElement?.hasAttribute("open"),
      ).toBe(true);
      expect(screen.queryByText("Loading editor…")).toBeNull();
      expect(
        screen
          .getByRole("tab", { name: "2 Second question" })
          .getAttribute("aria-selected"),
      ).toBe("false");

      nextQuestionReady = true;
      rerender(
        <ControlRoomClient
          publicSlug="test-poll"
          hostSecret="host-secret"
          startWithNewQuestion={startWithNewQuestion}
        />,
      );
      expect(
        (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
      ).toBe("Second question");
      expect(screen.getByLabelText("Your question").matches(":disabled")).toBe(
        false,
      );
      expect(
        screen
          .getByRole("tab", { name: "2 Second question" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(mocks.mutation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          questionId: "question-2",
          expectedChoiceIds: ["question-2-choice-1", "question-2-choice-2"],
        }),
      );
    },
  );

  test("keeps the current results visible until the next question loads", async () => {
    const user = userEvent.setup();
    const questions = mockTwoQuestionWorkspace();
    const query = mocks.query.getMockImplementation()!;
    let nextQuestionReady = false;
    mocks.query.mockImplementation((reference, args) => {
      const result = query(reference, args);
      if (getFunctionName(reference) === "presentation:getDeck") {
        return {
          ...result,
          questions: questions.map((q) => ({ ...q, closedGeneration: 0 })),
        };
      }
      if (getFunctionName(reference) === "presentation:getQuestionResults") {
        if (args.questionId === "question-2" && !nextQuestionReady)
          return undefined;
        return {
          ...result,
          ballotCount: args.questionId === "question-1" ? 12 : 7,
        };
      }
      return result;
    });
    const { rerender } = render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    await user.click(screen.getByRole("tab", { name: "2 Second question" }));
    expect(
      screen.getByRole("heading", { name: "First question" }),
    ).toBeTruthy();
    expect(screen.getByText("12 votes")).toBeTruthy();
    expect(screen.queryByText("Loading results…")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Reopen poll" })
        .hasAttribute("disabled"),
    ).toBe(true);

    nextQuestionReady = true;
    rerender(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    expect(
      screen.getByRole("heading", { name: "Second question" }),
    ).toBeTruthy();
    expect(screen.getByText("7 votes")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Reopen poll" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  test("switching saves the draft, opens the other editor, and restores saved edits on return", async () => {
    const user = userEvent.setup();
    const questions = mockTwoQuestionWorkspace();
    mocks.mutation.mockImplementation(async (args) => {
      const index = questions.findIndex((q) => q._id === args.questionId);
      questions[index] = { ...questions[index], prompt: args.prompt };
      return { questionId: args.questionId };
    });
    render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    expect(
      screen
        .getByRole("tab", { name: "1 First question" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.type(screen.getByLabelText("Your question"), " edited");
    await user.click(screen.getByRole("tab", { name: "2 Second question" }));
    expect(mocks.mutation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        questionId: "question-1",
        prompt: "First question edited",
        start: false,
        expectedChoiceIds: ["question-1-choice-1", "question-1-choice-2"],
      }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("Second question");
    expect(
      screen
        .getByRole("tab", { name: "2 Second question" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.click(
      screen.getByRole("tab", { name: "1 First question edited" }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("First question edited");
    await user.keyboard("{ArrowRight}{Enter}");
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("Second question");
  });

  test("a failed tab save keeps the current question and edits selected", async () => {
    const user = userEvent.setup();
    mockTwoQuestionWorkspace();
    mocks.mutation.mockRejectedValue(new Error("Offline"));
    render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    await user.type(screen.getByLabelText("Your question"), " edited");
    await user.click(screen.getByRole("tab", { name: "2 Second question" }));
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("First question edited");
    expect(
      screen
        .getByRole("tab", { name: "1 First question" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  test("new option images are uploaded and attached when switching questions", async () => {
    const user = userEvent.setup();
    mockTwoQuestionWorkspace();
    mocks.mutation
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example" })
      .mockResolvedValueOnce({ questionId: "question-1" });
    mocks.upload.mockResolvedValue({ storageId: "image-1" });
    render(
      <ControlRoomClient publicSlug="test-poll" hostSecret="host-secret" />,
    );
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.upload(
      screen.getByLabelText("Choose image for option 3"),
      new File(["image"], "option.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("tab", { name: "2 Second question" }));
    expect(mocks.mutation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        questionId: "question-1",
        start: false,
        choices: [
          { id: "question-1-choice-1", label: "One" },
          { id: "question-1-choice-2", label: "Two" },
          { label: "", imageId: "image-1" },
        ],
      }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("Second question");
  });

  test("switching from a new question saves it before opening an existing question", async () => {
    const user = userEvent.setup();
    mockTwoQuestionWorkspace();
    mocks.mutation.mockResolvedValue({ questionId: "question-3" });
    render(
      <ControlRoomClient
        publicSlug="test-poll"
        hostSecret="host-secret"
        startWithNewQuestion
      />,
    );
    expect(
      screen
        .getByRole("tab", { name: "3 New question" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await user.type(screen.getByLabelText("Your question"), "Third question");
    await user.click(screen.getByRole("tab", { name: "1 First question" }));
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Third question",
        questionId: undefined,
        start: false,
        expectedChoiceIds: [],
      }),
    );
    expect(
      (screen.getByLabelText("Your question") as HTMLTextAreaElement).value,
    ).toBe("First question");
  });
});
