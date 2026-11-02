import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ActionForm } from "@/components/auth/action-form";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/lib/auth/actions";

export const metadata = { title: "Create account — ITG TraderOS" };

export default function RegisterPage() {
  return (
    <AuthCard title="Create your account" subtitle="Start your trading journal — onboarding takes a few minutes, and you can skip anything you don't have.">
      <ActionForm action={signUpAction} submitLabel="Create account" submitClassName="itg2-btn-primary itg2-btn-save">
        <div className="itg2-field space-y-2">
          <Label htmlFor="fullName" className="itg2-label">Full name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" required placeholder="Your full name" className="itg2-input" />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor="email" className="itg2-label">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" className="itg2-input" />
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor="password" className="itg2-label">Password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
          <p className="text-xs text-muted-foreground">At least 8 characters, with an uppercase letter, a lowercase letter and a number.</p>
        </div>
        <div className="itg2-field space-y-2">
          <Label htmlFor="confirmPassword" className="itg2-label">Confirm password</Label>
          <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="itg2-link">
          Log in
        </Link>
      </p>
    </AuthCard>
  );
}
