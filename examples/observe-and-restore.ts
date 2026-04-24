import { sigma, Sigma } from "preact-sigma";

type TodoListState = {
  todos: string[];
};

class TodoList extends Sigma<TodoListState> {
  constructor() {
    super({
      todos: [],
    });
  }

  add(title: string) {
    this.todos.push(title);
  }
}

interface TodoList extends TodoListState {}

const todoList = new TodoList();
const stop = sigma.subscribe(todoList, (nextState, baseState) => {
  console.log(`${baseState.todos.length} -> ${nextState.todos.length}`);
});

todoList.add("Write docs");

const saved = sigma.captureState(todoList);

todoList.add("Ship release");
sigma.replaceState(todoList, saved);

console.log(sigma.captureState(todoList).todos); // ["Write docs"]

stop();
