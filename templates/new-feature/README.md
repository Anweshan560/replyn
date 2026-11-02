# Starter files for a new feature

Copy these, then replace `Widget` / `widget` / `widgets` with the feature's name
(see "Adding tests for a feature" in the main README):

| File                  | Copy to                                                                       |
| --------------------- | ----------------------------------------------------------------------------- |
| `WidgetsPage.ts`      | `pages/<area>/WidgetsPage.ts`                                                 |
| `WidgetsApi.ts`       | `api/WidgetsApi.ts` (and add the path to `ENDPOINTS` in `api/ResourceApi.ts`) |
| `widgets.spec.ts`     | `tests/<area>/widgets/widgets.spec.ts`                                        |
| `widgets.api.spec.ts` | `tests/<area>/widgets/widgets.api.spec.ts`                                    |

Then register `widgetsPage` and `widgetsApi` in `fixtures/test.ts` and add `buildWidget()` to
`utils/testData.ts`. These files are not compiled or run from here.
