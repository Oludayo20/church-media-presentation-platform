import { useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { Button, cn, Input, Label } from "@cmp/design-system";
import type { WorkspaceState } from "@cmp/shared-types";
import { settingsCatalog, type Settings } from "@cmp/shared-validation";
import { useWorkspaceStore } from "../../app/stores/workspace-store";
import { errorMessage } from "../../lib/ipc";
import { LogoPicker } from "../settings/LogoPicker";
import { ResolutionPicker } from "../settings/ResolutionPicker";
import { ThemePicker } from "../settings/ThemePicker";

const STEPS = ["Your church", "Logo", "Output & theme"] as const;
type Step = 0 | 1 | 2;

interface OnboardingProps {
  workspace: WorkspaceState;
  settings: Settings | null;
}

/**
 * First-launch onboarding (DOCUMENTATION.md §17.3, Journey 1): church name,
 * logo, output resolution and theme. Step 1 creates the workspace, so
 * closing the app mid-way resumes at step 2 with the name kept. Bible
 * translation, sample pack, display test and tour join in later phases.
 */
export function Onboarding({ workspace, settings }: OnboardingProps) {
  const [step, setStep] = useState<Step>(workspace.status === "none" ? 0 : 1);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <p className="mb-2 text-sm font-medium text-primary">
          Welcome to Church Media
        </p>
        <Stepper current={step} />
        <div className="mt-6 rounded-xl border border-border bg-surface p-8 shadow-lg">
          {step === 0 && (
            <ChurchStep
              initialName={
                workspace.status === "none"
                  ? ""
                  : workspace.workspace.churchName
              }
              onDone={() => setStep(1)}
            />
          )}
          {step === 1 && workspace.status !== "none" && (
            <StepFrame
              title="Add your church logo"
              body="Shown in the app and on the projector's logo screen. You can skip this and add it later in Settings."
              onBack={() => setStep(0)}
              footer={
                <Button onClick={() => setStep(2)}>
                  {workspace.workspace.logoAssetId
                    ? "Continue"
                    : "Skip for now"}
                </Button>
              }
            >
              <LogoPicker logoAssetId={workspace.workspace.logoAssetId} />
            </StepFrame>
          )}
          {step === 2 && settings && (
            <OutputStep settings={settings} onBack={() => setStep(1)} />
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          No account needed. Everything is stored on this computer and works
          offline.
        </p>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol aria-label="Onboarding progress" className="flex items-center gap-3">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted",
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={active ? "font-medium" : "text-muted"}>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="h-px w-6 bg-border" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepFrame({
  title,
  body,
  onBack,
  footer,
  children,
}: {
  title: string;
  body: string;
  onBack?: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
      {children}
      <div className="flex items-center justify-between pt-2">
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            <ChevronLeft className="size-4" aria-hidden />
            Back
          </Button>
        ) : (
          <span />
        )}
        {footer}
      </div>
    </div>
  );
}

function ChurchStep({
  initialName,
  onDone,
}: {
  initialName: string;
  onDone: () => void;
}) {
  const { workspace, createWorkspace, renameWorkspace } = useWorkspaceStore();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (workspace.status === "none") await createWorkspace(name);
      else if (name.trim() !== workspace.workspace.churchName)
        await renameWorkspace(name);
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <StepFrame
        title="What is your church called?"
        body="This names your workspace. You can change it later."
        footer={
          <Button type="submit" disabled={busy || name.trim() === ""}>
            Continue
          </Button>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="church-name">Church name</Label>
          <Input
            id="church-name"
            autoFocus
            placeholder="e.g. Grace Chapel, Ikeja"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "church-name-error" : undefined}
          />
          {error && (
            <p
              id="church-name-error"
              role="alert"
              className="text-sm text-live"
            >
              {error}
            </p>
          )}
        </div>
      </StepFrame>
    </form>
  );
}

function OutputStep({
  settings,
  onBack,
}: {
  settings: Settings;
  onBack: () => void;
}) {
  const { setSetting, completeOnboarding } = useWorkspaceStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const finish = async () => {
    setBusy(true);
    await save(completeOnboarding);
    setBusy(false);
  };

  const defaultResolution = settingsCatalog["display.outputResolution"].default;

  return (
    <StepFrame
      title="Projector output & appearance"
      body={`Pick the resolution of your projector or screen. Not sure? ${defaultResolution.w}×${defaultResolution.h} suits most modern projectors and TVs.`}
      onBack={onBack}
      footer={
        <Button disabled={busy} onClick={() => void finish()}>
          Finish setup
        </Button>
      }
    >
      <div className="space-y-2">
        <Label>Output resolution</Label>
        <ResolutionPicker
          value={settings["display.outputResolution"]}
          onChange={(value) =>
            void save(() => setSetting("display.outputResolution", value))
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Theme</Label>
        <ThemePicker
          value={settings["ui.theme"]}
          onChange={(theme) => void save(() => setSetting("ui.theme", theme))}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-live">
          {error}
        </p>
      )}
    </StepFrame>
  );
}
