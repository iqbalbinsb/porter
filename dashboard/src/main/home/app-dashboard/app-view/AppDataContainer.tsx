import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PorterApp } from "@porter-dev/api-contracts";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import _ from "lodash";
import AnimateHeight from "react-animate-height";
import { FormProvider, useForm } from "react-hook-form";
import { useHistory } from "react-router";
import styled from "styled-components";
import { match } from "ts-pattern";
import { z } from "zod";

import Banner from "components/porter/Banner";
import Button from "components/porter/Button";
import { Error as ErrorComponent } from "components/porter/Error";
import Icon from "components/porter/Icon";
import Link from "components/porter/Link";
import Spacer from "components/porter/Spacer";
import Tag from "components/porter/Tag";
import TabSelector from "components/TabSelector";
import { useAppAnalytics } from "lib/hooks/useAppAnalytics";
import { useAppValidation } from "lib/hooks/useAppValidation";
import { useIntercom } from "lib/hooks/useIntercom";
import {
  clientAppFromProto,
  porterAppFormValidator,
  type PorterAppFormData,
  type SourceOptions,
} from "lib/porter-apps";

import api from "shared/api";
import { Context } from "shared/Context";
import alert from "assets/alert-warning.svg";
import save from "assets/save-01.svg";

import ConfirmRedeployModal from "./ConfirmRedeployModal";
import { useLatestRevision } from "./LatestRevisionContext";
import Activity from "./tabs/Activity";
import EventFocusView from "./tabs/activity-feed/events/focus-views/EventFocusView";
import BuildSettingsTab from "./tabs/BuildSettingsTab";
import Environment from "./tabs/Environment";
import HelmEditorTab from "./tabs/HelmEditorTab";
import HelmLatestValuesTab from "./tabs/HelmLatestValuesTab";
import ImageSettingsTab from "./tabs/ImageSettingsTab";
import JobsTab from "./tabs/JobsTab";
import LogsTab from "./tabs/LogsTab";
import MetricsTab from "./tabs/MetricsTab";
import Notifications from "./tabs/Notifications";
import Overview from "./tabs/Overview";
import Settings from "./tabs/Settings";

// commented out tabs are not yet implemented
// will be included as support is available based on data from app revisions rather than helm releases
const validTabs = [
  "activity",
  "events",
  "overview",
  "logs",
  "metrics",
  // "debug",
  "environment",
  "build-settings",
  "image-settings",
  "settings",
  "helm-overrides",
  "helm-values",
  "job-history",
  "notifications",
] as const;
const DEFAULT_TAB = "activity";
type ValidTab = (typeof validTabs)[number];

type AppDataContainerProps = {
  tabParam?: string;
};

// todo(ianedwards): refactor button to use more predictable state
export type ButtonStatus = "" | "loading" | JSX.Element | "success";

const AppDataContainer: React.FC<AppDataContainerProps> = ({ tabParam }) => {
  const history = useHistory();
  const queryClient = useQueryClient();
  const [confirmDeployModalOpen, setConfirmDeployModalOpen] = useState(false);

  const { currentProject, user } = useContext(Context);

  const { updateAppStep } = useAppAnalytics();
  const { showIntercomWithMessage } = useIntercom();

  const {
    porterApp: porterAppRecord,
    latestProto,
    previewRevision,
    latestRevision,
    projectId,
    clusterId,
    deploymentTarget,
    servicesFromYaml,
    appEnv,
    setPreviewRevision,
    latestNotifications,
  } = useLatestRevision();
  const { validateApp, setServiceDeletions } = useAppValidation({
    deploymentTargetID: deploymentTarget.id,
  });

  const currentTab = useMemo(() => {
    if (tabParam && validTabs.includes(tabParam as ValidTab)) {
      return tabParam as ValidTab;
    }

    return DEFAULT_TAB;
  }, [tabParam]);

  const latestSource: SourceOptions = useMemo(() => {
    // because we store the image info in the app proto, we can refer to that for repository/tag instead of the app record
    if (porterAppRecord.image_repo_uri && latestProto.image) {
      return {
        type: "docker-registry",
        image: {
          repository: latestProto.image.repository,
          tag: latestProto.image.tag,
        },
      };
    }

    // the app proto does not contain the fields below, so we must pull them from the app record
    return {
      type: "github",
      git_repo_id: porterAppRecord.git_repo_id ?? 0,
      git_repo_name: porterAppRecord.repo_name ?? "",
      git_branch: porterAppRecord.git_branch ?? "",
      porter_yaml_path: porterAppRecord.porter_yaml_path ?? "./porter.yaml",
    };
  }, [porterAppRecord, latestProto]);

  const porterAppFormMethods = useForm<PorterAppFormData>({
    reValidateMode: "onSubmit",
    resolver: zodResolver(porterAppFormValidator),
    defaultValues: {
      app: clientAppFromProto({
        proto: latestProto,
        overrides: servicesFromYaml,
      }),
      source: latestSource,
      deletions: {
        serviceNames: [],
        envGroupNames: [],
        predeploy: [],
      },
    },
  });

  const {
    reset,
    handleSubmit,
    setError,
    formState: {
      isDirty,
      dirtyFields,
      isSubmitting,
      errors,
      isSubmitSuccessful,
    },
  } = porterAppFormMethods;

  // getAllDirtyFields recursively gets all dirty fields from the dirtyFields object
  // all fields in the form are set to a boolean indicating if the current value is different from the default value
  const getAllDirtyFields = (dirtyFields: object): string[] => {
    const dirty: string[] = [];

    Object.entries(dirtyFields).forEach(([key, value]) => {
      if (value) {
        if (typeof value === "boolean" && value) {
          dirty.push(key);
        }

        if (typeof value === "object") {
          dirty.push(...getAllDirtyFields(value));
        }
      }
    });

    return dirty;
  };

  // onlyExpandedChanged is true if the only dirty fields are expanded and id
  // expanded is a ui only value used to determine if a service is expanded or not
  // id is set by useFieldArray and is also not relevant to the app proto
  const onlyExpandedChanged = useMemo(() => {
    if (!isDirty) return false;

    // get all entries in entire dirtyFields object that are true
    const dirty = getAllDirtyFields(dirtyFields);
    return dirty.every((f) => f === "expanded" || f === "id");
  }, [isDirty, JSON.stringify(dirtyFields)]);

  const buildIsDirty = useMemo(() => {
    if (!isDirty) return false;

    // get all entries in entire dirtyFields object that are true
    const dirty = getAllDirtyFields(dirtyFields.app?.build ?? {});
    return dirty.some((f) => f);
  }, [isDirty, JSON.stringify(dirtyFields)]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      const { variables, secrets, validatedAppProto } = await validateApp(
        data,
        currentProject?.beta_features_enabled
      );

      const needsRebuild =
        buildIsDirty ||
        latestRevision.status === "BUILD_FAILED" ||
        latestRevision.status === "PREDEPLOY_FAILED";

      if (needsRebuild && !data.redeployOnSave) {
        setConfirmDeployModalOpen(true);
        return;
      }

      if (currentProject?.beta_features_enabled && !needsRebuild) {
        const serviceDeletions = setServiceDeletions(data.app.services);

        await api.updateApp(
          "<token>",
          {
            b64_app_proto: btoa(validatedAppProto.toJsonString()),
            deployment_target_id: deploymentTarget.id,
            variables,
            secrets,
            is_env_override: true,
            deletions: {
              service_names: data.deletions.serviceNames.map((s) => s.name),
              predeploy: data.deletions.predeploy.map((s) => s.name),
              env_group_names: data.deletions.envGroupNames.map(
                (eg) => eg.name
              ),
              service_deletions: serviceDeletions,
            },
          },
          {
            project_id: projectId,
            cluster_id: clusterId,
          }
        );
      }

      // force_build will create a new 0 revision that will not be deployed
      // but will be used to hydrate values when the workflow is run
      if (!currentProject?.beta_features_enabled) {
        await api.applyApp(
          "<token>",
          {
            b64_app_proto: btoa(validatedAppProto.toJsonString()),
            deployment_target_id: deploymentTarget.id,
            force_build: needsRebuild,
            variables,
            secrets,
            hard_env_update: true,
          },
          {
            project_id: projectId,
            cluster_id: clusterId,
          }
        );
      }

      if (latestSource.type === "github" && needsRebuild) {
        if (currentProject?.beta_features_enabled && validatedAppProto.build) {
          await api.updateBuildSettings(
            "<token>",
            {
              build_settings: validatedAppProto.build,
              deployment_target_id: deploymentTarget.id,
            },
            {
              project_id: projectId,
              cluster_id: clusterId,
              porter_app_name: porterAppRecord.name,
            }
          );
        }

        const res = await api.reRunGHWorkflow(
          "<token>",
          {},
          {
            project_id: projectId,
            cluster_id: clusterId,
            git_installation_id: latestSource.git_repo_id,
            owner: latestSource.git_repo_name.split("/")[0],
            name: latestSource.git_repo_name.split("/")[1],
            branch: porterAppRecord.git_branch,
            filename: "porter_stack_" + porterAppRecord.name + ".yml",
          }
        );

        if (res.data != null) {
          window.open(res.data, "_blank", "noreferrer");
        }
      }
      await queryClient.invalidateQueries([
        "getLatestRevision",
        projectId,
        clusterId,
        deploymentTarget.id,
        porterAppRecord.name,
      ]);
      setPreviewRevision(null);

      if (deploymentTarget.isPreview) {
        history.push(
          `/preview-environments/apps/${porterAppRecord.name}/${DEFAULT_TAB}?target=${deploymentTarget.id}`
        );
        return;
      }

      // redirect to the default tab after save
      history.push(`/apps/${porterAppRecord.name}/${DEFAULT_TAB}`);
    } catch (err) {
      showIntercomWithMessage({
        message: "I am running into an issue updating my application.",
      });

      let message =
        "App update failed: please try again or contact support@porter.run if the error persists.";
      let stack = "Unable to get error stack";

      if (axios.isAxiosError(err)) {
        const parsed = z
          .object({ error: z.string() })
          .safeParse(err.response?.data);
        if (parsed.success) {
          message = `App update failed: ${parsed.data.error}`;
        }
        stack = err.stack ?? "(No error stack)";
      }

      void updateAppStep({
        step: "porter-app-update-failure",
        errorMessage: message,
        appName: latestProto.name,
        errorStackTrace: stack,
      });
      setError("app", {
        message,
      });
    }
  });

  const cancelRedeploy = useCallback(() => {
    const resetProto = previewRevision
      ? PorterApp.fromJsonString(atob(previewRevision.b64_app_proto), {
          ignoreUnknownFields: true,
        })
      : latestProto;

    // we don't store versions of build settings because they are stored in the db, so we just have to use the latest version
    // however, for image settings, we can pull image repo and tag from the proto
    const resetSource =
      porterAppRecord.image_repo_uri && resetProto.image
        ? {
            type: "docker-registry" as const,
            image: {
              repository: resetProto.image.repository,
              tag: resetProto.image.tag,
            },
          }
        : latestSource;

    reset({
      app: clientAppFromProto({
        proto: resetProto,
        overrides: servicesFromYaml,
        variables: appEnv?.variables,
        secrets: appEnv?.secret_variables,
      }),
      source: resetSource,
      deletions: {
        predeploy: [],
        envGroupNames: [],
        serviceNames: [],
      },
      redeployOnSave: false,
    });
    setConfirmDeployModalOpen(false);
  }, [previewRevision, latestProto, servicesFromYaml, appEnv, latestSource]);

  const finalizeDeploy = useCallback(() => {
    setConfirmDeployModalOpen(false);
    void onSubmit();
  }, [onSubmit, setConfirmDeployModalOpen]);

  const buttonStatus = useMemo(() => {
    if (isSubmitting) {
      return "loading";
    }

    // TODO: create a more unified way of parsing form/apply errors, unified with the logic in CreateApp
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const stringifiedJson = JSON.stringify(errors);
      let errorMessage =
        "App update failed. Please try again. If the error persists, please contact support@porter.run.";
      if (errorKeys.includes("app")) {
        const appErrors = Object.keys(errors.app ?? {});
        if (appErrors.includes("build")) {
          errorMessage = "Build settings are not properly configured.";
        } else if (appErrors.includes("services")) {
          errorMessage = "Service settings are not properly configured";
          if (
            errors.app?.services?.root?.message ??
            errors.app?.services?.message
          ) {
            const serviceErrorMessage =
              errors.app?.services?.root?.message ??
              errors.app?.services?.message;
            errorMessage = `${errorMessage} - ${serviceErrorMessage}`;
          }
          errorMessage = `${errorMessage}. To undo all changes, refresh the page.`;
        } else if (appErrors.includes("env")) {
          errorMessage = "Environment variables are not properly configured";
          if (errors.app?.env?.root?.message ?? errors.app?.env?.message) {
            const envErrorMessage =
              errors.app?.env?.root?.message ?? errors.app?.env?.message;
            errorMessage = `${errorMessage} - ${envErrorMessage}`;
          }
          errorMessage = `${errorMessage}. To undo all changes, refresh the page.`;
        } else if (appErrors.includes("message")) {
          // this is the high level error message coming from the apply
          errorMessage = errors.app?.message ?? errorMessage;
        }
      }

      showIntercomWithMessage({
        message: "I am running into an issue updating my application.",
      });
      void updateAppStep({
        step: "porter-app-update-failure",
        errorMessage: `Form validation error (visible to user): ${errorMessage}. Stringified JSON errors (invisible to user): ${stringifiedJson}`,
        appName: latestProto.name,
      });

      return <ErrorComponent message={errorMessage} maxWidth="600px" />;
    }

    if (isSubmitSuccessful) {
      return "success";
    }

    return "";
  }, [isSubmitting, JSON.stringify(errors)]);

  const tabs = useMemo(() => {
    const numNotifications = latestNotifications.length;

    const base = [
      {
        label: `Notifications`,
        value: "notifications",
        sibling:
          numNotifications > 0 ? (
            <Tag borderColor={"#FFBF00"}>
              <Link
                to={`/apps/${latestProto.name}/notifications`}
                color={"#FFBF00"}
              >
                <TagIcon src={alert} />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    fontSize: "13px",
                  }}
                >
                  {numNotifications}
                </div>
              </Link>
            </Tag>
          ) : undefined,
      },
      { label: "Activity", value: "activity" },
      { label: "Overview", value: "overview" },
      { label: "Logs", value: "logs" },
      { label: "Metrics", value: "metrics" },
      { label: "Environment", value: "environment" },
    ];

    if (deploymentTarget.isPreview) {
      return base;
    }

    if (latestProto.build) {
      base.push({
        label: "Build Settings",
        value: "build-settings",
      });
    } else {
      base.push({
        label: "Image Settings",
        value: "image-settings",
      });
    }

    if ((currentProject?.helm_values_enabled ?? false) || user?.isPorterUser) {
      base.push({ label: "Helm Overrides", value: "helm-overrides" });
    }
    if (user?.isPorterUser) {
      base.push({ label: "Latest Helm Values", value: "helm-values" });
    }

    base.push({ label: "Settings", value: "settings" });
    return base;
  }, [
    deploymentTarget.isPreview,
    latestProto.build,
    latestNotifications.length,
  ]);

  useEffect(() => {
    const newProto = previewRevision
      ? PorterApp.fromJsonString(atob(previewRevision.b64_app_proto), {
          ignoreUnknownFields: true,
        })
      : latestProto;

    // we don't store versions of build settings because they are stored in the db, so we just have to use the latest version
    // however, for image settings, we can pull image repo and tag from the proto
    const newSource =
      porterAppRecord.image_repo_uri && newProto.image
        ? {
            type: "docker-registry" as const,
            image: {
              repository: newProto.image.repository,
              tag: newProto.image.tag,
            },
          }
        : latestSource;

    reset({
      app: clientAppFromProto({
        proto: newProto,
        overrides: servicesFromYaml,
        variables: appEnv?.variables,
        secrets: appEnv?.secret_variables,
      }),
      source: newSource,
      deletions: {
        envGroupNames: [],
        serviceNames: [],
        predeploy: [],
      },
      redeployOnSave: false,
    });
  }, [
    servicesFromYaml,
    currentTab,
    JSON.stringify(latestProto),
    previewRevision,
    latestRevision.revision_number,
    appEnv,
  ]);

  return (
    <FormProvider {...porterAppFormMethods}>
      <form onSubmit={onSubmit}>
        <AnimateHeight height={isDirty && !onlyExpandedChanged ? "auto" : 0}>
          <Banner
            type="warning"
            suffix={
              <>
                <Button
                  type="submit"
                  loadingText={"Updating..."}
                  height={"10px"}
                  status={isSubmitting ? "loading" : ""}
                  disabled={
                    isSubmitting ||
                    latestRevision.status === "CREATED" ||
                    latestRevision.status === "AWAITING_BUILD_ARTIFACT"
                  }
                  disabledTooltipMessage="Please wait for the deploy to complete before updating the app"
                  disabledTooltipPosition="bottom"
                >
                  <Icon src={save} height={"13px"} />
                  <Spacer inline x={0.5} />
                  Save as latest version
                </Button>
              </>
            }
          >
            Changes you are currently previewing have not been saved.
            <Spacer inline width="5px" />
          </Banner>
          <Spacer y={1} />
        </AnimateHeight>
        <TabSelector
          noBuffer
          options={tabs}
          currentTab={currentTab}
          setCurrentTab={(tab) => {
            if (deploymentTarget.isPreview) {
              history.push(
                `/preview-environments/apps/${porterAppRecord.name}/${tab}?target=${deploymentTarget.id}`
              );
              return;
            }
            history.push(`/apps/${porterAppRecord.name}/${tab}`);
          }}
        />
        <Spacer y={1} />
        {match(currentTab)
          .with("activity", () => <Activity />)
          .with("overview", () => <Overview buttonStatus={buttonStatus} />)
          .with("build-settings", () => (
            <BuildSettingsTab buttonStatus={buttonStatus} />
          ))
          .with("image-settings", () => (
            <ImageSettingsTab buttonStatus={buttonStatus} />
          ))
          .with("environment", () => (
            <Environment
              latestSource={latestSource}
              buttonStatus={buttonStatus}
            />
          ))
          .with("settings", () => <Settings />)
          .with("logs", () => <LogsTab />)
          .with("metrics", () => <MetricsTab />)
          .with("events", () => <EventFocusView />)
          .with("job-history", () => <JobsTab />)
          .with("helm-overrides", () => (
            <HelmEditorTab
              buttonStatus={buttonStatus}
              featureFlagEnabled={currentProject?.helm_values_enabled ?? false}
            />
          ))
          .with("helm-values", () => <HelmLatestValuesTab />)
          .with("notifications", () => <Notifications />)
          .otherwise(() => null)}
        <Spacer y={2} />
      </form>
      {confirmDeployModalOpen ? (
        <ConfirmRedeployModal
          setOpen={setConfirmDeployModalOpen}
          cancelRedeploy={cancelRedeploy}
          finalizeDeploy={finalizeDeploy}
          buildIsDirty={buildIsDirty}
        />
      ) : null}
    </FormProvider>
  );
};

export default AppDataContainer;

const TagIcon = styled.img`
  height: 13px;
  margin-right: 3px;
  margin-top: 1px;
`;
