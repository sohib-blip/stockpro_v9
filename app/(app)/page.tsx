import { redirect } from "next/navigation";

export default function Home() {
  // Landing page: go straight to dashboard
  redirect("/dashboard");
}
