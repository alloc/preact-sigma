import { sigma, SigmaType } from "preact-sigma";

const TodoList = new SigmaType<{
  todos: string[];
}>("TodoList")
  .defaultState({
    todos: [],
  })
  .actions({
    add(title: string) {
      this.todos.push(title);
    },
  });

const todoList = new TodoList();
const stop = sigma.subscribe(todoList, (change) => {
  console.log(`${change.oldState.todos.length} -> ${change.newState.todos.length}`);
});

todoList.add("Write docs");

const saved = sigma.getState(todoList);

todoList.add("Ship release");
sigma.replaceState(todoList, saved);

console.log(sigma.getState(todoList).todos); // ["Write docs"]

stop();
