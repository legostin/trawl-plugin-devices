import type { TrawlHost } from "./trawl";

/**
 * Three very different reasons the steps are not on screen, and one of them
 * used to look exactly like the other two: an empty list.
 */
export function explainRowsError(message: string): { title: string; hint: string; canRestart: boolean } {
  if (/404|unknown route|not found/i.test(message)) {
    return {
      title: "Этот агент не умеет показывать шаги",
      hint: "Разбор сценария на шаги появился в trawl-devices-agent 0.21.0. Перезапустите агента — он подтянет свежую версию.",
      canRestart: true,
    };
  }
  if (/syntax error|unexpected/i.test(message)) {
    return {
      title: "Сценарий не разбирается",
      hint: `Пока в файле синтаксическая ошибка, шаги показать нечем. Вкладка code — там же, где её видно: ${message}`,
      canRestart: false,
    };
  }
  return { title: "Шаги не получены", hint: message, canRestart: false };
}

export function RowsError({
  host,
  message,
  onRestartAgent,
}: {
  host: TrawlHost;
  message: string;
  onRestartAgent: () => void;
}) {
  const { Button } = host.ui;
  const { title, hint, canRestart } = explainRowsError(message);

  return (
    <div className="p-4 flex flex-col items-start gap-2 text-sm">
      <span className="text-destructive">{title}</span>
      <span className="text-muted-foreground text-xs max-w-[520px]">{hint}</span>
      {canRestart && (
        <Button size="sm" onClick={onRestartAgent}>
          Restart agent
        </Button>
      )}
    </div>
  );
}
