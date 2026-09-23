/**
 * A password field you can look at.
 *
 * Typing a password blind on a phone keypad, at a counter, in a hurry, is how
 * a correct password becomes a failed sign-in — and the person then doubts the
 * password rather than the typing. The eye costs nothing and removes the doubt.
 *
 * It starts hidden, and the button says which state it will move to rather than
 * which state it is in, because that is the question someone is asking when
 * they reach for it.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Input>) {
  const [shown, setShown] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        // Never submits the form it sits in, and never takes the tab focus
        // away from the next field.
        tabIndex={-1}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
