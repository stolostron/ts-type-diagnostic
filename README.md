# ts-type-diagnostic

## Translate typescript type assignment errors into a conflict table.

<br/>

### Instead of something like this:

![before](./images/before.png)

<br/>

### Something like this:

![after](./images/after.png)
<br/><br/>

# Installation

```shell
# Globally.
npm install -g ts-type-diagnostic
```

# Usage

## Command Line

```shell
# Create a table for a ts file with a conflict error.
tstd file.ts

# Create a verbose table.
tstd --v file.ts
```

## <br/><br/>

# tl:dr; Semantic Errors

Most Typescript errors are on the same line they occur and easy to follow:

```shell
# Can't assign A to B.
const A: number;
const B: string = A;
```

But where does Typescript put the error if:

- A is declared on another line, perhaps in another file, perhaps in another package
- B is also defined in another place and package
- B is a code block from which A is returned
- A and B are both type shapes with mismatched or missing properties
- B is an array and A is an array item

It gets even harder when A and B are used in a function. Does Typescript put the error on the caller or the callee?

```shell
# Can't call func with number.
const B = 123
func(B)
...
function func(A: string) { ... }
```

<br/>
Now imagine what happens if B is a shape type created with OMITs, PARTIALs, etc and A is also created with special types, and A is a return type on a B function, and A is in conflict with B?

<br/>

That's how you get this error:

![before](./images/before.png)

<br/>
To add insult to injury, this error might also appear on a line that has none of the properties mentioned in the error:

```shell
  # Yikes.
  return NodeShape
```

<br/>
If you study a message like this long enough you'll come to realize it's simply meant as a haiku to pain. Advanced users are much more proficient in realizing they're about to have a bad day.
<br/><br/>

# What this diagnostic does

Because the two conflicting types can be anywhere, this diagnostic creates a table in the terminal:

<br/>

![after](./images/after.png)

**What's shown:**

- The title is a simplified version of the error message
- The columns represent B on the left and A on the right
- The column headers include a link to B, A

**Table content:**

- If the conflict is a simple type (string!==number), the content will be a single line
- When the conflict is a type shape, the diagnostic will add lines for each property in that type
- If a type's property is also defined with a type shape, indented lines are added for those properties
- This diagnostic will continue to dig down until it finds a conflict

**Table colors/colours:**

- green - type matches
- yellow - type mismatch (ex: string !== number; string literal !== string)
- red - property is missing from one type shape
- blue - property has a type shape which won't be checked until the other property problems on this level are resolved

**Table notes:**

- For mismatched or missing properties, a link is provided
- Lines that are too long to fit in the table are concatenated and shown in its entirety in a note
- Sometimes a suggestion is added on how to fix the problem

<br/>
The suggestion for this table is to make the missing properties optional. Although this might sound drastic, all it really does is cause Typescript to throw errors when you you try to use that property without making sure it's there--iow:

```shell
  # Instead of this:
  if (shape.contextMenuOpen) { ... }

  # Something like this:
  if (shape?.contextMenuOpen) { ... }
```

Another acceptable answer would be to add those properties to B's type.

Once you fix that problem however remember Typescript will now dig into those blue properties and possibly find more conflicts.
