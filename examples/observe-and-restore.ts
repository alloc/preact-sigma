import { replaceState, SigmaType, snapshot } from "preact-sigma";

const TodoList = new SigmaType<{
  todos: string[];
}>("TodoList")
  .defaultState({
    todos: [],
  })
  .observe(function (change) {
    console.log(`${change.oldState.todos.length} -> ${change.newState.todos.length}`);
  })
  .actions({
    add(title: string) {
      this.todos.push(title);
    },
  });

const todoList = new TodoList();

todoList.add("Write docs");

const saved = snapshot(todoList);

todoList.add("Ship release");
replaceState(todoList, saved);

console.log(snapshot(todoList).todos); // ["Write docs"]
