import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect, useState } from "react";
import { Context } from "shared/Context";
import api from "shared/api";
import { z } from "zod";

const deploymentTargetValidator = z.object({
  deployment_target_id: z.string(),
});
type DeploymentTarget = z.infer<typeof deploymentTargetValidator>;

export function useDefaultDeploymentTarget() {
  const { currentProject, currentCluster } = useContext(Context);
  const [
    deploymentTarget,
    setDeploymentTarget,
  ] = useState<DeploymentTarget | null>(null);

  const { data } = useQuery(
    ["getDefaultDeploymentTarget", currentProject?.id, currentCluster?.id],
    async () => {
      // see Context.tsx L98 for why the last check is necessary
      if (
        !currentProject?.id ||
        !currentCluster?.id ||
        currentCluster.id === -1
      ) {
        return;
      }
      const res = await api.getDefaultDeploymentTarget(
        "<token>",
        {},
        {
          project_id: currentProject?.id,
          cluster_id: currentCluster?.id,
        }
      );

      return deploymentTargetValidator.parseAsync(res.data);
    },
    {
      enabled:
        !!currentProject &&
        !!currentCluster &&
        currentProject.validate_apply_v2,
    }
  );

  useEffect(() => {
    if (data) {
      setDeploymentTarget(data);
    }
  }, [data]);

  return deploymentTarget;
}
