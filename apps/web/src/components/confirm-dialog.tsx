import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** What a confirmation asks: its title, the sentence under it and the action. */
export interface ConfirmQuestion {
  title: string;
  body: string;
  action: string;
}

/**
 * A question before an action that changes more than the user may expect,
 * such as adding a task a whole team gets: Cancel, then the action. The
 * description timelog and the task pickers share it.
 */
export function ConfirmDialog({
  question,
  open,
  onOpenChange,
  onConfirm,
}: {
  question: ConfirmQuestion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{question?.title}</AlertDialogTitle>
          <AlertDialogDescription>{question?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {question?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
