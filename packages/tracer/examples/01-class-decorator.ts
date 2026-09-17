// Decorate a whole class — every method becomes traced under "ClassName.method".
// Run inside trace.collect to actually capture events.
//
// Run with: npx tsx examples/01-class-decorator.ts

import { marker, Trace, trace } from "../src";

@Trace
class UserService {
  private store = new Map<string, { id: string; name: string }>([
    ["u1", { id: "u1", name: "Alice" }],
  ]);

  findUser(id: string) {
    marker("lookup-start", { id });
    const found = this.store.get(id);
    marker("lookup-end", { hit: !!found });
    return found ?? null;
  }

  save(user: { id: string; name: string }) {
    if (!this.validate(user)) {
      throw new Error("invalid user");
    }
    this.store.set(user.id, user);
    return user;
  }

  private validate(user: { id: string; name: string }) {
    return user.id.length > 0 && user.name.length > 0;
  }
}

const service = new UserService();

const { names, result } = trace.collect(() => {
  service.save({ id: "u2", name: "Bob" });
  return service.findUser("u2");
});

console.log("result:", result);
console.log("names:");
for (const name of names) console.log("  ", name);

// Output:
// result: { id: "u2", name: "Bob" }
// names:
//    UserService.save
//    UserService.validate
//    UserService.findUser
//    UserService.findUser.lookup-start
//    UserService.findUser.lookup-end
