---
extractors:
  - image: vonwig/readme-extractor:latest
    entrypoint: /project
  - image: vonwig/extractor-node:latest
---

## Description

The prompts for docker rely only on the classic lsp project extraction function.

The output of running this container is a json document that will be merged into the
context that is provided to the moustache template based prompts.

It relies on an image to extract some additional facts about the project

## Building the extraction image

```sh
#docker:command=build-npm-extractor
docker build -t vonwig/extractor-node -f ./npm_setup/Dockerfile ./npm_setup
```

## Running the extraction image

```sh
#docker:command=run-npm-extractor
docker run --rm -v $PWD:/project:ro vonwig/extractor-node
```

