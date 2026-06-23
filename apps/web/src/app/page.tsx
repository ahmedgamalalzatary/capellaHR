import { redirect } from "next/navigation";

/** Entry point. The employee sign-in is the default landing page. */
export default function HomePage() {
  redirect("/sign-in");
}
