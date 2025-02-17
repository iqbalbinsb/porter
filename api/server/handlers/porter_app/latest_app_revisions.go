package porter_app

import (
	"net/http"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	porterv1 "github.com/porter-dev/api-contracts/generated/go/porter/v1"
	"github.com/porter-dev/porter/api/server/handlers"
	"github.com/porter-dev/porter/api/server/shared"
	"github.com/porter-dev/porter/api/server/shared/apierrors"
	"github.com/porter-dev/porter/api/server/shared/config"
	"github.com/porter-dev/porter/api/types"
	"github.com/porter-dev/porter/internal/models"
	"github.com/porter-dev/porter/internal/porter_app"
	"github.com/porter-dev/porter/internal/telemetry"
)

// LatestAppRevisionsHandler handles requests to the /apps/revisions endpoint
type LatestAppRevisionsHandler struct {
	handlers.PorterHandlerReadWriter
}

// NewLatestAppRevisionsHandler returns a new LatestAppRevisionsHandler
func NewLatestAppRevisionsHandler(
	config *config.Config,
	decoderValidator shared.RequestDecoderValidator,
	writer shared.ResultWriter,
) *LatestAppRevisionsHandler {
	return &LatestAppRevisionsHandler{
		PorterHandlerReadWriter: handlers.NewDefaultPorterHandler(config, decoderValidator, writer),
	}
}

// LatestAppRevisionsRequest represents the request for the /apps/revisions endpoint
type LatestAppRevisionsRequest struct {
	DeploymentTargetID string `schema:"deployment_target_id"`
}

// LatestRevisionWithSource is an app revision and its source porter app
type LatestRevisionWithSource struct {
	AppRevision porter_app.Revision `json:"app_revision"`
	Source      types.PorterApp     `json:"source"`
}

// LatestAppRevisionsResponse represents the response from the /apps/revisions endpoint
type LatestAppRevisionsResponse struct {
	AppRevisions []LatestRevisionWithSource `json:"app_revisions"`
}

func (c *LatestAppRevisionsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := telemetry.NewSpan(r.Context(), "serve-list-app-revisions")
	defer span.End()

	project, _ := r.Context().Value(types.ProjectScope).(*models.Project)
	cluster, _ := r.Context().Value(types.ClusterScope).(*models.Cluster)

	request := &LatestAppRevisionsRequest{}
	if ok := c.DecodeAndValidate(w, r, request); !ok {
		err := telemetry.Error(ctx, span, nil, "error decoding request")
		c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusBadRequest))
		return
	}

	deploymentTargetID, err := uuid.Parse(request.DeploymentTargetID)
	if err != nil {
		err := telemetry.Error(ctx, span, err, "error parsing deployment target id")
		c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusBadRequest))
		return
	}
	if deploymentTargetID == uuid.Nil {
		err := telemetry.Error(ctx, span, nil, "deployment target id is nil")
		c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusBadRequest))
		return
	}

	listAppRevisionsReq := connect.NewRequest(&porterv1.LatestAppRevisionsRequest{
		ProjectId:          int64(project.ID),
		DeploymentTargetId: deploymentTargetID.String(),
	})

	latestAppRevisionsResp, err := c.Config().ClusterControlPlaneClient.LatestAppRevisions(ctx, listAppRevisionsReq)
	if err != nil {
		err = telemetry.Error(ctx, span, err, "error getting latest app revisions")
		c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusInternalServerError))
		return
	}

	if latestAppRevisionsResp == nil || latestAppRevisionsResp.Msg == nil {
		err = telemetry.Error(ctx, span, nil, "latest app revisions response is nil")
		c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusInternalServerError))
		return
	}

	appRevisions := latestAppRevisionsResp.Msg.AppRevisions
	if appRevisions == nil {
		appRevisions = []*porterv1.AppRevision{}
	}

	res := &LatestAppRevisionsResponse{
		AppRevisions: make([]LatestRevisionWithSource, 0),
	}

	for _, revision := range appRevisions {
		encodedRevision, err := porter_app.EncodedRevisionFromProto(ctx, revision)
		if err != nil {
			err := telemetry.Error(ctx, span, err, "error getting encoded revision from proto")
			c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusInternalServerError))
			return
		}

		porterApp, err := c.Repo().PorterApp().ReadPorterAppByName(cluster.ID, revision.App.Name)
		if err != nil {
			err := telemetry.Error(ctx, span, err, "error reading porter app")
			c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusInternalServerError))
			return
		}
		if porterApp == nil {
			err := telemetry.Error(ctx, span, err, "porter app is nil")
			c.HandleAPIError(w, r, apierrors.NewErrPassThroughToClient(err, http.StatusInternalServerError))
			return
		}

		res.AppRevisions = append(res.AppRevisions, LatestRevisionWithSource{
			AppRevision: encodedRevision,
			Source:      *porterApp.ToPorterAppType(),
		})
	}

	c.WriteResult(w, r, res)
}
